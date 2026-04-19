import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { UsersService } from '../users/users.service';
import { AuditService } from '../common/audit/audit.service';
import { PLANS, PLAN_DETAILS } from './plans.config';
import { Workspace } from '../workspace/entities/workspace.entity';
import { WorkspaceMember } from '../workspace/entities/workspace-member.entity';
import { User } from '../users/entities/user.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { TelegramAlertService } from '../common/telegram-alert.service';
import { OutboxService } from './outbox/outbox.service';
import { maskEmail } from '../common/utils/pii';

export interface EffectiveAccess {
  plan: 'free' | 'pro' | 'organization';
  source: 'own' | 'team' | 'grace_team' | 'grace_pro' | 'free';
  graceUntil?: Date;
  graceDaysLeft?: number;
  isTeamOwner: boolean;
  isTeamMember: boolean;
  hasOwnPro: boolean;
  workspaceId?: string;
  workspaceExpiringAt?: Date;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly webhookSecret: string;
  private readonly apiKey: string;
  private readonly storeId: string;
  private readonly proVariantId: string;
  private readonly proYearlyVariantId: string;
  private readonly teamVariantId: string;
  private readonly teamYearlyVariantId: string;

  constructor(
    private readonly cfg: ConfigService,
    private readonly usersService: UsersService,
    @InjectRepository(Workspace) private readonly workspaceRepo: Repository<Workspace>,
    @InjectRepository(WorkspaceMember) private readonly workspaceMemberRepo: Repository<WorkspaceMember>,
    @InjectRepository(WebhookEvent) private readonly webhookEventRepo: Repository<WebhookEvent>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly telegramAlert: TelegramAlertService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {
    this.webhookSecret = cfg.get('LEMON_SQUEEZY_WEBHOOK_SECRET', '');
    this.apiKey = cfg.get('LEMON_SQUEEZY_API_KEY', '');
    this.storeId = cfg.get('LEMON_SQUEEZY_STORE_ID', '');
    // Support both old and new env variable names
    this.proVariantId =
      cfg.get('LEMON_SQUEEZY_PRO_MONTHLY_VARIANT_ID', '') ||
      cfg.get('LEMON_SQUEEZY_PRO_VARIANT_ID', '874616');
    this.proYearlyVariantId =
      cfg.get('LEMON_SQUEEZY_PRO_YEARLY_VARIANT_ID', '') || this.proVariantId;
    this.teamVariantId =
      cfg.get('LEMON_SQUEEZY_TEAM_MONTHLY_VARIANT_ID', '') ||
      cfg.get('LEMON_SQUEEZY_TEAM_VARIANT_ID', '874623');
    this.teamYearlyVariantId =
      cfg.get('LEMON_SQUEEZY_TEAM_YEARLY_VARIANT_ID', '') || this.teamVariantId;
  }

  private extractBillingPeriod(productId: string): 'monthly' | 'yearly' {
    return productId?.toLowerCase().includes('yearly') ? 'yearly' : 'monthly';
  }

  /**
   * Single source of truth for what a user can access RIGHT NOW.
   * Considers: own subscription, team membership, grace period.
   */
  async getEffectiveAccess(user: User): Promise<EffectiveAccess> {
    const now = new Date();

    // Find team membership (status ACTIVE)
    const member = await this.workspaceMemberRepo.findOne({
      where: { userId: user.id, status: 'ACTIVE' as any },
    });

    let workspace: Workspace | null = null;
    let teamOwnerHasActiveSubscription = false;

    if (member) {
      workspace = await this.workspaceRepo.findOne({ where: { id: member.workspaceId } });
      if (workspace && !workspace.expiredAt) {
        const owner = await this.usersService.findById(workspace.ownerId).catch(() => null);
        teamOwnerHasActiveSubscription =
          !!owner && owner.plan === 'organization' && !owner.cancelAtPeriodEnd;
      }
    }

    const isTeamOwner = !!(workspace && workspace.ownerId === user.id);
    const isTeamMember = !!member;
    const hasOwnPro =
      user.billingSource === 'revenuecat' &&
      (user.plan === 'pro' || user.plan === 'organization') &&
      !user.cancelAtPeriodEnd;

    const computeDaysLeft = (date: Date | null): number | undefined => {
      if (!date) return undefined;
      const ms = date.getTime() - now.getTime();
      if (ms <= 0) return undefined;
      return Math.ceil(ms / (1000 * 60 * 60 * 24));
    };

    // Owner with active organization plan
    if (isTeamOwner && (user.plan === 'organization' || user.plan === 'pro')) {
      return {
        plan: 'organization',
        source: 'own',
        isTeamOwner: true,
        isTeamMember: true,
        hasOwnPro,
        workspaceId: workspace!.id,
      };
    }

    // Active team member (owner pays)
    if (isTeamMember && teamOwnerHasActiveSubscription) {
      return {
        plan: 'organization',
        source: 'team',
        isTeamOwner: false,
        isTeamMember: true,
        hasOwnPro,
        workspaceId: workspace!.id,
      };
    }

    // Own RC subscription active
    if (hasOwnPro) {
      return {
        plan: user.plan as 'pro' | 'organization',
        source: 'own',
        isTeamOwner,
        isTeamMember,
        hasOwnPro: true,
        workspaceId: workspace?.id,
        workspaceExpiringAt: workspace?.expiredAt ?? undefined,
      };
    }

    // Trial active
    if (user.trialEndDate && new Date(user.trialEndDate) > now) {
      return {
        plan: 'pro',
        source: 'own',
        isTeamOwner,
        isTeamMember,
        hasOwnPro: false,
        workspaceId: workspace?.id,
      };
    }

    // Grace period
    if (user.gracePeriodEnd && new Date(user.gracePeriodEnd) > now) {
      const graceDate = new Date(user.gracePeriodEnd);
      return {
        plan: 'pro',
        source: user.gracePeriodReason === 'team_expired' ? 'grace_team' : 'grace_pro',
        graceUntil: graceDate,
        graceDaysLeft: computeDaysLeft(graceDate),
        isTeamOwner,
        isTeamMember,
        hasOwnPro: false,
        workspaceId: workspace?.id,
        workspaceExpiringAt: workspace?.expiredAt ?? undefined,
      };
    }

    // Default: free
    return {
      plan: 'free',
      source: 'free',
      isTeamOwner,
      isTeamMember,
      hasOwnPro: false,
      workspaceId: workspace?.id,
      workspaceExpiringAt: workspace?.expiredAt ?? undefined,
    };
  }

  private async handleTeamOwnerExpiration(ownerId: string): Promise<void> {
    const workspace = await this.workspaceRepo.findOne({ where: { ownerId } });
    if (!workspace) return;

    workspace.expiredAt = new Date();
    await this.workspaceRepo.save(workspace);

    const members = await this.workspaceMemberRepo.find({
      where: { workspaceId: workspace.id, status: 'ACTIVE' as any },
    });

    for (const m of members) {
      if (m.userId === ownerId) continue;
      const u = await this.usersService.findById(m.userId).catch(() => null);
      if (!u) continue;

      // Member has their own active RC subscription — they should keep access on
      // their own paid plan. Organization-tier membership only made sense while the
      // team workspace was active; since it expired, demote them to personal 'pro'
      // (they paid individually). No grace period needed — they already pay.
      if (u.billingSource === 'revenuecat' && !u.cancelAtPeriodEnd) {
        if (u.plan === 'organization' || u.plan === 'free') {
          u.plan = 'pro';
        }
        u.gracePeriodEnd = null;
        u.gracePeriodReason = null;
        await this.usersService.save(u);
        continue;
      }

      u.gracePeriodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      u.gracePeriodReason = 'team_expired';
      await this.usersService.save(u);
    }
    this.logger.log(`Team owner ${ownerId} expired — cascaded grace to ${members.length} members`);
  }

  /**
   * Synchronous, DB-only view of the user's effective plan.
   *
   * NOTE: for the full picture (team membership, grace periods) use
   * `getEffectiveAccess()`. This helper is intentionally fast & sync —
   * it's safe to call inside guards / feature flags that only care about
   * the user's own billing state.
   *
   * Rules:
   *   - plan='free'                             → 'free'
   *   - trial active (trialEndDate > now)       → user.plan
   *   - trial expired, billingSource='trial'    → 'free'
   *   - trial expired, no billingSource         → 'free'
   *   - RC/LS cancelled + currentPeriodEnd < now→ 'free' (grace expired)
   *   - RC/LS cancelled + currentPeriodEnd > now→ user.plan (still in period)
   *   - RC/LS active                            → user.plan
   */
  getEffectivePlan(user: any): string {
    if (!user) return 'free';
    if (user.plan === 'free') return 'free';

    const now = new Date();

    // Trial path — only valid while trialEndDate is in the future.
    const trialActive = user.trialEndDate && new Date(user.trialEndDate) > now;
    if (user.billingSource === 'trial') {
      return trialActive ? user.plan : 'free';
    }
    if (trialActive) {
      // Legacy trial without explicit billingSource — still honour it.
      return user.plan;
    }

    // No paid source and trial already used / absent → back to free.
    if (!user.billingSource) {
      return 'free';
    }

    // Paid subscription — respect cancel-at-period-end.
    if (user.cancelAtPeriodEnd && user.currentPeriodEnd) {
      const periodEnd = new Date(user.currentPeriodEnd);
      if (periodEnd.getTime() <= now.getTime()) return 'free';
    }

    return user.plan;
  }

  private readonly RC_PRODUCT_TO_PLAN: Record<string, string> = {
    // Production product IDs
    'io.subradar.mobile.pro.monthly': 'pro',
    'io.subradar.mobile.pro.yearly': 'pro',
    'io.subradar.mobile.team.monthly': 'organization',
    'io.subradar.mobile.team.yearly': 'organization',
    // Sandbox / StoreKit test product IDs (same identifiers, just in case)
    'com.goalin.subradar.pro.monthly': 'pro',
    'com.goalin.subradar.pro.yearly': 'pro',
    'com.goalin.subradar.team.monthly': 'organization',
    'com.goalin.subradar.team.yearly': 'organization',
  };

  /**
   * HMAC-SHA256 compare with timing-safe equal. Accepts an optional fallback
   * secret (LEMON_SQUEEZY_WEBHOOK_SECRET_V2) so we can rotate the webhook
   * signing secret without downtime: set V2 to the new secret, redeploy, then
   * flip the primary and drop V2 when Lemon Squeezy confirms the cutover.
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!signature) return false;
    const primary = this.webhookSecret;
    const secondary = this.cfg.get<string>('LEMON_SQUEEZY_WEBHOOK_SECRET_V2', '');

    const check = (secret: string): boolean => {
      if (!secret) return false;
      const digest = createHmac('sha256', secret).update(payload).digest('hex');
      const digestBuf = Buffer.from(digest);
      const signatureBuf = Buffer.from(signature);
      if (digestBuf.length !== signatureBuf.length) return false;
      return timingSafeEqual(digestBuf, signatureBuf);
    };

    if (check(primary)) return true;
    if (secondary && check(secondary)) {
      this.logger.warn(
        'Webhook verified with LEMON_SQUEEZY_WEBHOOK_SECRET_V2 — rotate primary when ready',
      );
      return true;
    }
    return false;
  }

  /**
   * Attempt to claim a webhook event for processing. Returns:
   *   - `true`  if this is the first time we've seen this (provider, eventId)
   *   - `false` if the event was already processed (duplicate delivery)
   *
   * The unique index on (provider, event_id) is the source of truth — on
   * UNIQUE-constraint violation the INSERT fails and we know someone else
   * (or an earlier retry) has already handled this event.
   */
  async claimWebhookEvent(provider: string, eventId: string): Promise<boolean> {
    if (!eventId) {
      // Without a stable event_id we can't dedupe — just let it through
      // and rely on downstream idempotency of the individual operations.
      this.logger.warn(`claimWebhookEvent: missing eventId for provider=${provider}`);
      return true;
    }
    try {
      await this.webhookEventRepo.insert({ provider, eventId });
      return true;
    } catch (err) {
      const isUniqueViolation =
        err instanceof QueryFailedError &&
        ((err as any).code === '23505' ||
          /duplicate key|unique constraint/i.test(String((err as any).message)));
      if (isUniqueViolation) {
        this.logger.log(
          `claimWebhookEvent: duplicate ${provider} event ${eventId} — skipping`,
        );
        return false;
      }
      throw err;
    }
  }

  /**
   * Send a Telegram alert about a webhook failure and re-throw so the
   * provider (RC / LS) can retry delivery. `userEmail` is masked before
   * sending — we don't want full PII in the alert channel.
   */
  private async alertWebhookFailure(
    provider: 'revenuecat' | 'lemon_squeezy',
    eventType: string,
    userEmail: string | undefined,
    err: unknown,
  ): Promise<void> {
    const msg = err instanceof Error ? err.message : String(err);
    const text =
      `[billing-webhook] <b>${provider}</b> failure\n` +
      `event: <code>${eventType || 'unknown'}</code>\n` +
      `user:  <code>${maskEmail(userEmail ?? '')}</code>\n` +
      `error: <code>${msg.slice(0, 500)}</code>`;
    try {
      await this.telegramAlert.send(text, `webhook:${provider}:${eventType}:${msg.slice(0, 80)}`);
    } catch (alertErr) {
      this.logger.warn(`alertWebhookFailure: telegram send failed: ${alertErr}`);
    }
  }

  /**
   * Entry point for Lemon Squeezy webhooks. The controller passes the full
   * parsed body so we can:
   *   1. Dedupe via `body.meta.webhook_id`
   *   2. Extract event name from `body.meta.event_name`
   *   3. Alert Telegram on failure and re-throw (so LS retries)
   */
  async handleLemonSqueezyWebhook(body: any): Promise<void> {
    const event: string = body?.meta?.event_name ?? '';
    const data = body?.data;
    const eventId: string =
      body?.meta?.webhook_id ||
      body?.meta?.event_id ||
      (data?.id && event ? `${event}:${data.id}:${data?.attributes?.updated_at ?? ''}` : '');

    const email: string | undefined = data?.attributes?.user_email;

    const claimed = await this.claimWebhookEvent('lemon_squeezy', eventId);
    if (!claimed) return;

    try {
      await this.handleWebhook(event, data);
    } catch (err) {
      this.logger.error(
        `Lemon Squeezy webhook ${event} failed: ${err instanceof Error ? err.stack : err}`,
      );
      // Roll back the idempotency record so LS retries on the next delivery.
      await this.webhookEventRepo
        .delete({ provider: 'lemon_squeezy', eventId })
        .catch(() => undefined);
      await this.alertWebhookFailure('lemon_squeezy', event, email, err);
      throw err;
    }
  }

  async handleWebhook(event: string, data: any) {
    this.logger.log(`Lemon Squeezy webhook: ${event}`);

    switch (event) {
      case 'subscription_created':
      case 'subscription_updated': {
        const customerId = data?.attributes?.customer_id;
        const email = data?.attributes?.user_email;
        const status = data?.attributes?.status;
        const variantId = String(data?.attributes?.variant_id ?? '');
        const teamVariants = [
          process.env.LEMON_SQUEEZY_TEAM_MONTHLY_VARIANT_ID,
          process.env.LEMON_SQUEEZY_TEAM_YEARLY_VARIANT_ID,
          '1377279', '1377285',
        ].filter(Boolean);
        const isTeam = teamVariants.includes(variantId);

        if (email) {
          const user = await this.usersService.findByEmail(email);
          if (user) {
            const isActive = status === 'active' || status === 'on_trial';
            const yearlyVariants = [
              process.env.LEMON_SQUEEZY_PRO_YEARLY_VARIANT_ID,
              process.env.LEMON_SQUEEZY_TEAM_YEARLY_VARIANT_ID,
              '1377285',
            ].filter(Boolean);
            const isYearly = yearlyVariants.includes(variantId);
            const updates: any = {
              plan: isActive ? (isTeam ? 'organization' : 'pro') : 'free',
              billingPeriod: isActive ? (isYearly ? 'yearly' : 'monthly') : null,
              lemonSqueezyCustomerId: String(customerId),
              billingSource: 'lemon_squeezy',
            };
            this.logger.log(`Webhook upgrade: email=${maskEmail(email)} variantId=${variantId} isTeam=${isTeam} plan=${updates.plan} period=${updates.billingPeriod} status=${status}`);
            const previousPlan = user.plan;
            await this.usersService.update(user.id, updates);
            await this.audit.log({
              userId: user.id,
              action: 'billing.webhook.plan_change',
              resourceType: 'user',
              resourceId: user.id,
              metadata: {
                provider: 'lemon_squeezy',
                event,
                previousPlan,
                nextPlan: updates.plan,
                billingPeriod: updates.billingPeriod,
                variantId,
                lemonSqueezyStatus: status,
              },
            });
          }
        }
        break;
      }
      case 'subscription_cancelled': {
        const email = data?.attributes?.user_email;
        if (email) {
          const user = await this.usersService.findByEmail(email);
          if (user) {
            const previousPlan = user.plan;
            await this.usersService.update(user.id, { plan: 'free' });
            await this.audit.log({
              userId: user.id,
              action: 'billing.webhook.plan_change',
              resourceType: 'user',
              resourceId: user.id,
              metadata: {
                provider: 'lemon_squeezy',
                event,
                previousPlan,
                nextPlan: 'free',
              },
            });
            if (user.proInviteeEmail) {
              await this.downgradeInviteeIfEligible(user.proInviteeEmail);
              await this.usersService.update(user.id, { proInviteeEmail: undefined as any });
            }
          }
        }
        break;
      }
      case 'order_created': {
        this.logger.log('Order created:', data?.id);
        break;
      }
    }
  }

  async handleRevenueCatWebhook(body: any): Promise<void> {
    const event = body?.event;
    if (!event) return;

    const type: string = event.type;
    const appUserId: string = event.app_user_id;
    const productId: string = event.product_id;

    // RC provides a stable `event.id` on every delivery.
    const eventId: string =
      event.id ||
      (type && appUserId ? `${type}:${appUserId}:${event.event_timestamp_ms ?? ''}` : '');

    if (!appUserId || appUserId.startsWith('$RCAnonymousID')) {
      this.logger.warn(`RevenueCat webhook: anonymous user, type: ${type}`);
      return;
    }

    const claimed = await this.claimWebhookEvent('revenuecat', eventId);
    if (!claimed) return;

    const user = await this.usersService.findById(appUserId).catch(() => null);
    if (!user) {
      this.logger.warn(`RevenueCat webhook: user ${appUserId} not found`);
      return;
    }

    try {
      await this.processRevenueCatEvent(type, event, user, productId);
    } catch (err) {
      this.logger.error(
        `RevenueCat webhook ${type} failed: ${err instanceof Error ? err.stack : err}`,
      );
      // Roll back idempotency record so RC retries on the next delivery.
      await this.webhookEventRepo
        .delete({ provider: 'revenuecat', eventId })
        .catch(() => undefined);
      await this.alertWebhookFailure('revenuecat', type, user.email, err);
      throw err;
    }
  }

  private async processRevenueCatEvent(
    type: string,
    event: any,
    user: User,
    productId: string,
  ): Promise<void> {
    const appUserId = user.id;
    switch (type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE': {
        const plan = this.RC_PRODUCT_TO_PLAN[productId] || 'pro';
        const billingPeriod = this.extractBillingPeriod(productId);
        const previousPlan = user.plan;
        user.plan = plan;
        user.billingPeriod = billingPeriod;
        user.billingSource = 'revenuecat';
        // Reset cancellation flags — purchase/renewal supersedes cancellation
        user.cancelAtPeriodEnd = false;
        user.currentPeriodEnd = null;
        user.gracePeriodEnd = null;
        user.gracePeriodReason = null;
        user.billingIssueAt = null;
        await this.usersService.save(user);
        const ownedWs = await this.workspaceRepo.findOne({ where: { ownerId: user.id } });
        if (ownedWs && ownedWs.expiredAt) {
          ownedWs.expiredAt = null;
          await this.workspaceRepo.save(ownedWs);
        }
        this.logger.log(`RevenueCat: ${type} — user ${appUserId} → plan ${plan} (${billingPeriod})`);
        await this.audit.log({
          userId: user.id,
          action: 'billing.webhook.plan_change',
          resourceType: 'user',
          resourceId: user.id,
          metadata: {
            provider: 'revenuecat',
            event: type,
            productId,
            previousPlan,
            nextPlan: plan,
            billingPeriod,
          },
        });
        break;
      }
      case 'CANCELLATION': {
        // Mark as cancelled but keep plan active until period end
        const expiresAtRaw = event.expiration_at_ms || event.expiration_at;
        const expiresAt = expiresAtRaw
          ? new Date(typeof expiresAtRaw === 'number' ? expiresAtRaw : Number(expiresAtRaw))
          : null;
        user.cancelAtPeriodEnd = true;
        if (expiresAt && !isNaN(expiresAt.getTime())) {
          user.currentPeriodEnd = expiresAt;
        }
        await this.usersService.save(user);
        this.logger.log(`RevenueCat: CANCELLATION — user ${appUserId}, access until ${expiresAt?.toISOString() ?? 'unknown'}`);
        break;
      }
      case 'EXPIRATION': {
        const previousPlan = user.plan;
        user.plan = 'free';
        user.billingPeriod = null;
        user.downgradedAt = new Date();
        user.billingSource = null as any;
        user.cancelAtPeriodEnd = false;
        user.currentPeriodEnd = null as any;
        user.billingIssueAt = null;
        user.gracePeriodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        user.gracePeriodReason = 'pro_expired';
        await this.usersService.save(user);
        this.logger.log(`RevenueCat: EXPIRATION — user ${appUserId} → free, grace 7d`);
        await this.audit.log({
          userId: user.id,
          action: 'billing.webhook.plan_change',
          resourceType: 'user',
          resourceId: user.id,
          metadata: {
            provider: 'revenuecat',
            event: 'EXPIRATION',
            previousPlan,
            nextPlan: 'free',
            gracePeriodReason: 'pro_expired',
          },
        });
        await this.handleTeamOwnerExpiration(user.id);
        break;
      }
      case 'UNCANCELLATION': {
        user.cancelAtPeriodEnd = false;
        user.currentPeriodEnd = null;
        user.gracePeriodEnd = null;
        user.gracePeriodReason = null;
        user.billingIssueAt = null;
        await this.usersService.save(user);
        const ownedWs = await this.workspaceRepo.findOne({ where: { ownerId: user.id } });
        if (ownedWs && ownedWs.expiredAt) {
          ownedWs.expiredAt = null;
          await this.workspaceRepo.save(ownedWs);
        }
        this.logger.log(`RevenueCat: UNCANCELLATION — user ${appUserId}, subscription restored`);
        break;
      }
      case 'BILLING_ISSUE': {
        // Apple grace period — payment failed but subscription still active
        // for X days while Apple retries. User needs to update payment method.
        user.billingIssueAt = new Date();
        await this.usersService.save(user);
        this.logger.warn(`RevenueCat: BILLING_ISSUE — user ${appUserId}, billing grace started`);
        break;
      }
      default:
        this.logger.log(`RevenueCat: unhandled event ${type}`);
    }
  }

  resolveVariantId(planIdOrVariantId: string, billing: 'monthly' | 'yearly' = 'monthly'): string {
    // If it looks like a numeric variant ID, use directly
    if (/^\d+$/.test(planIdOrVariantId)) return planIdOrVariantId;
    // Resolve from env-based config
    if (planIdOrVariantId === 'pro') {
      return billing === 'yearly' ? this.proYearlyVariantId : this.proVariantId;
    }
    if (planIdOrVariantId === 'organization' || planIdOrVariantId === 'team') {
      return billing === 'yearly' ? this.teamYearlyVariantId : this.teamVariantId;
    }
    // Fallback to plan config
    const plan = PLAN_DETAILS.find((p) => p.id === planIdOrVariantId);
    if (plan && 'variantIdMonthly' in plan) {
      return (plan as any).variantIdMonthly;
    }
    return planIdOrVariantId;
  }

  async createCheckout(userId: string, planIdOrVariantId: string, email: string, billing: 'monthly' | 'yearly' = 'monthly') {
    const variantId = this.resolveVariantId(planIdOrVariantId, billing);
    this.logger.log(`Creating checkout: plan=${planIdOrVariantId} variantId=${variantId} billing=${billing} email=${maskEmail(email)}`);

    let response: Response;
    try {
      response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/vnd.api+json',
          Accept: 'application/vnd.api+json',
        },
        body: JSON.stringify({
          data: {
            type: 'checkouts',
            attributes: {
              checkout_data: {
                email,
                custom: { user_id: userId },
              },
              product_options: {
                redirect_url: 'https://app.subradar.ai/app/settings?checkout=success',
                receipt_button_text: 'Go to SubRadar',
                receipt_link_url: 'https://app.subradar.ai/app/settings',
              },
            },
            relationships: {
              store: { data: { type: 'stores', id: String(this.storeId) } },
              variant: { data: { type: 'variants', id: String(variantId) } },
            },
          },
        }),
      });
    } catch (err) {
      this.logger.error(`LS fetch failed: ${err}`);
      throw new BadRequestException('Payment provider unavailable. Try again later.');
    }

    const result = (await response.json()) as any;

    if (!response.ok || result?.errors) {
      const errDetail = result?.errors?.[0]?.detail || result?.errors?.[0]?.title || 'Unknown LS error';
      this.logger.error(`LS checkout error (${response.status}): ${errDetail} | variantId=${variantId}`);
      throw new BadRequestException(`Checkout failed: ${errDetail}`);
    }

    const url = result?.data?.attributes?.url;
    if (!url) {
      this.logger.error(`LS checkout: no URL in response: ${JSON.stringify(result).slice(0, 300)}`);
      throw new BadRequestException('Checkout URL not returned by payment provider.');
    }

    this.logger.log(`Checkout created: ${url.slice(0, 60)}`);
    return { url };
  }

  /**
   * @deprecated Trial is now managed by Apple/RevenueCat via Introductory Offers.
   * Kept for backward compatibility with older app versions.
   * New clients should use purchasePackage with trial-eligible RC product instead.
   */
  async startTrial(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (user.trialUsed) {
      throw new BadRequestException('Trial has already been used for this account');
    }
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    await this.usersService.update(userId, {
      plan: 'pro',
      trialUsed: true,
      trialStartDate: now,
      trialEndDate: trialEnd,
    });
  }

  /**
   * Activate a Pro-invite seat for `inviteeEmail` granted by `ownerId`.
   *
   * Wrapped in a single DB transaction with `pessimistic_write` locks on
   * both owner and invitee rows so concurrent webhook writes (e.g. the
   * owner cancelling at the same moment) cannot race into a state where
   * the invitee is upgraded after the owner has already lost Pro.
   *
   * Side-effects:
   *  - audit log row (`billing.pro_invite_activated`)
   *  - amplitude event enqueued via the transactional outbox (`manager`
   *    passed so the enqueue commits with the plan write).
   */
  async activateProInvite(ownerId: string, inviteeEmail: string): Promise<void> {
    const email = inviteeEmail.toLowerCase().trim();
    await this.dataSource.transaction(async (m) => {
      const owner = await m.findOne(User, {
        where: { id: ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!owner) throw new NotFoundException('Owner not found');
      if (owner.plan !== 'pro' && owner.plan !== 'organization') {
        throw new ForbiddenException('Only Pro or Organization users can send invites');
      }
      if (owner.cancelAtPeriodEnd) {
        throw new BadRequestException('Cannot invite while subscription is cancelled');
      }
      if (owner.proInviteeEmail) {
        throw new ConflictException('You already have an active invite. Remove it first.');
      }

      const invitee = await m.findOne(User, {
        where: { email },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invitee) throw new NotFoundException(`User with email ${email} not found`);
      if (invitee.id === owner.id) throw new BadRequestException('You cannot invite yourself');
      if (invitee.plan !== 'free') {
        throw new ConflictException('User already on a paid plan');
      }

      invitee.plan = 'pro';
      invitee.billingSource = null as any;
      invitee.invitedByUserId = owner.id;
      owner.proInviteeEmail = email;
      await m.save([owner, invitee]);

      await this.audit.log({
        userId: owner.id,
        action: 'billing.pro_invite_activated',
        resourceType: 'user',
        resourceId: invitee.id,
        metadata: { email: maskEmail(email) },
      });
      await this.outbox.enqueue(
        'amplitude.track',
        {
          event: 'billing.pro_invite_sent',
          userId: owner.id,
          properties: { inviteeId: invitee.id },
        },
        m,
      );
    });
  }

  async removeProInvite(ownerId: string): Promise<void> {
    const owner = await this.usersService.findById(ownerId);
    if (!owner.proInviteeEmail) {
      throw new BadRequestException('No active invite to remove');
    }
    await this.downgradeInviteeIfEligible(owner.proInviteeEmail);
    await this.usersService.update(ownerId, { proInviteeEmail: undefined as any });
  }

  /**
   * Downgrade an invitee to free — only if they don't have their own paid
   * subscription. Uses a pessimistic lock so concurrent writes (e.g. owner
   * cancels while invitee is mid-checkout) can't race into an inconsistent
   * state where we clobber a freshly-purchased billingSource.
   *
   * Emits an audit entry + amplitude event through the outbox so membership
   * graph churn is observable alongside the plan change.
   */
  private async downgradeInviteeIfEligible(inviteeEmail: string): Promise<void> {
    const email = inviteeEmail.toLowerCase().trim();
    await this.dataSource.transaction(async (m) => {
      const invitee = await m.findOne(User, {
        where: { email },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invitee) return;
      // If the invitee now has their own paid subscription we must NOT
      // reset them to free — their plan is theirs.
      if (invitee.billingSource) return;
      if (invitee.plan === 'free') return;

      const previousPlan = invitee.plan;
      const inviterId = invitee.invitedByUserId;
      invitee.plan = 'free';
      invitee.billingSource = null as any;
      invitee.invitedByUserId = null;
      await m.save(invitee);

      await this.audit.log({
        userId: inviterId ?? invitee.id,
        action: 'billing.pro_invite_deactivated',
        resourceType: 'user',
        resourceId: invitee.id,
        metadata: { email: maskEmail(email), previousPlan },
      });
      await this.outbox.enqueue(
        'amplitude.track',
        {
          event: 'billing.pro_invite_revoked',
          userId: inviterId ?? invitee.id,
          properties: { inviteeId: invitee.id, previousPlan },
        },
        m,
      );
    });
  }

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async consumeAiRequest(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    const currentMonth = this.getCurrentMonth();
    // getEffectiveAccess already incorporates team membership, grace
    // periods AND trial expiry — no need to call getEffectivePlan here,
    // but double-check the access plan isn't somehow stale.
    const effective = await this.getEffectiveAccess(user);
    const effectivePlan = effective.plan;
    const planConfig = PLANS[effectivePlan] ?? PLANS.free;

    const needsReset = user.aiRequestsMonth !== currentMonth;
    const currentUsed = needsReset ? 0 : user.aiRequestsUsed;

    if (planConfig.aiRequestsLimit !== null && currentUsed >= planConfig.aiRequestsLimit) {
      throw new ForbiddenException(
        `AI request limit reached (${planConfig.aiRequestsLimit}/month). Upgrade to increase your limit.`,
      );
    }

    await this.usersService.update(userId, {
      aiRequestsUsed: currentUsed + 1,
      aiRequestsMonth: currentMonth,
    });
  }

  async syncRevenueCat(userId: string, productId: string): Promise<void> {
    // MANDATORY server-side verification — never trust the client.
    // Without the REST API key we cannot confirm the entitlement, so we
    // refuse the sync (503) rather than upgrading blindly. This protects
    // us from trivial curl-based plan forgery.
    const rcApiKey =
      this.cfg.get<string>('REVENUECAT_API_KEY_SECRET', '') ||
      this.cfg.get<string>('REVENUECAT_API_KEY', '');
    if (!rcApiKey) {
      this.logger.error(
        'syncRevenueCat: REVENUECAT_API_KEY_SECRET not set — refusing to sync without server-side verification',
      );
      throw new ServiceUnavailableException(
        'Billing verification is temporarily unavailable. Please try again later.',
      );
    }

    // Resolve plan and billing period from productId first (still validated below against RC entitlements).
    let plan = this.RC_PRODUCT_TO_PLAN[productId];
    if (!plan) {
      const lower = productId.toLowerCase();
      if (lower.includes('team') || lower.includes('org')) {
        plan = 'organization';
      } else if (lower.includes('pro') || lower.includes('premium')) {
        plan = 'pro';
      } else {
        this.logger.warn(`syncRevenueCat: unknown productId "${productId}", defaulting to pro`);
        plan = 'pro';
      }
    }
    const billingPeriod = this.extractBillingPeriod(productId);

    // Call RevenueCat REST API to confirm the user actually has an active
    // entitlement. Docs: https://www.revenuecat.com/docs/service/api-reference
    let rcRes: Response;
    try {
      rcRes = await fetch(
        `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
        {
          headers: {
            Authorization: `Bearer ${rcApiKey}`,
            Accept: 'application/json',
          },
        },
      );
    } catch (e) {
      this.logger.error(`syncRevenueCat: RC API fetch failed: ${e}`);
      throw new ServiceUnavailableException(
        'Billing verification is temporarily unavailable. Please try again later.',
      );
    }

    if (!rcRes.ok) {
      this.logger.warn(
        `syncRevenueCat: RC API returned ${rcRes.status} for user ${userId}`,
      );
      throw new ServiceUnavailableException(
        'Billing verification is temporarily unavailable. Please try again later.',
      );
    }

    let rcData: any;
    try {
      rcData = await rcRes.json();
    } catch (e) {
      this.logger.error(`syncRevenueCat: RC API returned invalid JSON: ${e}`);
      throw new ServiceUnavailableException(
        'Billing verification is temporarily unavailable. Please try again later.',
      );
    }

    const entitlements = rcData?.subscriber?.entitlements ?? {};
    const now = Date.now();

    const isEntitlementActive = (e: any): boolean => {
      if (!e) return false;
      if (e.expires_date === null || e.expires_date === undefined) return true;
      const ts = typeof e.expires_date === 'number'
        ? e.expires_date
        : Date.parse(e.expires_date);
      return !isNaN(ts) && ts > now;
    };

    // Require an active entitlement that matches the requested plan tier.
    // Match flexibly: RC dashboard often uses display names like "SubRadar Pro"
    // or "Team Access" rather than canonical slugs. We accept any entitlement
    // whose lowercased name contains a relevant keyword AND whose productId
    // (when present) matches the purchase we're syncing.
    const planKeywords = plan === 'organization'
      ? ['team', 'org', 'organization']
      : ['pro', 'premium'];

    const matchesPlanTier = (name: string, value: any): boolean => {
      const lcName = name.toLowerCase();
      if (planKeywords.some((k) => lcName.includes(k))) return true;
      // Fallback: entitlement tied to the exact product we just purchased.
      const entProductId = String(value?.product_identifier ?? '').toLowerCase();
      return entProductId === productId.toLowerCase();
    };

    const matchingActive = Object.entries(entitlements).some(
      ([name, value]: [string, any]) =>
        matchesPlanTier(name, value) && isEntitlementActive(value),
    );

    if (!matchingActive) {
      const seen = Object.keys(entitlements).join(',') || '<none>';
      this.logger.warn(
        `syncRevenueCat: user ${userId} has no active entitlement matching tier=${plan} (product=${productId}); RC returned entitlements=[${seen}]`,
      );
      throw new ForbiddenException(
        'No active RevenueCat entitlement found for this account.',
      );
    }

    const user = await this.usersService.findById(userId);
    // Team membership takes precedence: if user is part of a team workspace,
    // we keep plan='organization' via effective access but record the independent
    // Pro purchase in hasOwnPro so it survives leaving the team. The `plan`
    // column is a simple "own subscription" marker; team access is computed
    // elsewhere via getEffectiveAccess().
    user.plan = plan;
    user.billingPeriod = billingPeriod;
    user.billingSource = 'revenuecat';
    // Reset cancellation flags — verified purchase supersedes any previous cancellation
    user.cancelAtPeriodEnd = false;
    user.currentPeriodEnd = null;
    await this.usersService.save(user);
    this.logger.log(
      `syncRevenueCat: verified via RC — user ${userId} → plan ${plan} (${billingPeriod}, product: ${productId})`,
    );
  }

  async getBillingInfo(userId: string, subscriptionCount: number) {
    const user = await this.usersService.findById(userId);
    const effective = await this.getEffectiveAccess(user);
    const effectivePlan = effective.plan;
    const planConfig = PLANS[effectivePlan] ?? PLANS.free;
    const currentMonth = this.getCurrentMonth();

    const aiRequestsUsed =
      user.aiRequestsMonth === currentMonth ? user.aiRequestsUsed : 0;

    let trialDaysLeft: number | null = null;
    let status: 'active' | 'cancelled' | 'trialing' = 'active';

    if (user.cancelAtPeriodEnd) {
      status = 'cancelled';
    }

    if (!user.cancelAtPeriodEnd && user.billingSource !== 'revenuecat' && user.trialEndDate) {
      const now = Date.now();
      const end = new Date(user.trialEndDate).getTime();
      if (end > now) {
        status = 'trialing';
        trialDaysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
      }
    }

    const periodEnd = user.currentPeriodEnd ?? user.trialEndDate ?? null;

    return {
      plan: effectivePlan,
      source: effective.source,
      isTeamOwner: effective.isTeamOwner,
      isTeamMember: effective.isTeamMember,
      hasOwnPro: effective.hasOwnPro,
      graceUntil: effective.graceUntil?.toISOString() ?? null,
      graceDaysLeft: effective.graceDaysLeft ?? null,
      workspaceExpiringAt: effective.workspaceExpiringAt?.toISOString() ?? null,
      hasBillingIssue: !!user.billingIssueAt,
      billingIssueAt: user.billingIssueAt?.toISOString() ?? null,
      billingPeriod: user.billingPeriod ?? 'monthly',
      status,
      currentPeriodEnd: periodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: user.cancelAtPeriodEnd ?? false,
      trialUsed: user.trialUsed,
      trialDaysLeft,
      subscriptionCount,
      subscriptionLimit: planConfig.subscriptionLimit,
      aiRequestsUsed,
      aiRequestsLimit: planConfig.aiRequestsLimit,
      proInviteeEmail: user.proInviteeEmail ?? null,
      downgradedAt: user.downgradedAt?.toISOString() ?? null,
    };
  }

  async cancelSubscription(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);

    // Cancel trial: clear trial dates, reset plan to free
    // Only if not already paying via RevenueCat (trial superseded by real purchase)
    if (user.trialEndDate && new Date(user.trialEndDate) > new Date() && user.billingSource !== 'revenuecat') {
      await this.usersService.update(userId, {
        plan: 'free',
        trialEndDate: undefined as any,
        billingSource: undefined as any,
      });
      this.logger.log(`cancelSubscription: trial cancelled for user ${userId}`);
      return;
    }

    // Cancel RC subscription: mark cancelAtPeriodEnd, RC will send EXPIRATION when period ends
    if (user.plan !== 'free' && user.billingSource === 'revenuecat') {
      await this.usersService.update(userId, {
        cancelAtPeriodEnd: true,
      });
      this.logger.log(`cancelSubscription: RC subscription marked cancel-at-period-end for user ${userId}`);
      return;
    }

    // Cancel non-RC paid subscription: downgrade to free immediately
    if (user.plan !== 'free') {
      await this.usersService.update(userId, {
        plan: 'free',
        billingSource: undefined as any,
        cancelAtPeriodEnd: false,
      });
      this.logger.log(`cancelSubscription: plan cancelled for user ${userId}`);
      return;
    }

    // Already free — nothing to cancel
    this.logger.warn(`cancelSubscription: user ${userId} already on free plan`);
  }
}
