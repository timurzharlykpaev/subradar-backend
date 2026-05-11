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
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
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
import { TrialsService } from './trials/trials.service';
import { pushT } from '../notifications/push-i18n';
import { maskEmail } from '../common/utils/pii';
import {
  mapRCEventToBillingEvent,
  PRODUCT_TO_PLAN as RC_PRODUCT_TO_PLAN_MAP,
  RCRawEvent,
} from './revenuecat/event-mapper';
import { mapLSEventToBillingEvent } from './lemon-squeezy/event-mapper';
import { UserBillingRepository } from './user-billing.repository';
import { inferEventFromRcSnapshot } from './state-machine/infer-rc-event';
import { RCSubscriberSnapshot } from './state-machine/types';

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
    private readonly trialsService: TrialsService,
    private readonly userBilling: UserBillingRepository,
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
    // A user is "still on Pro/Team" while EITHER:
    //   - the sub auto-renews (!cancelAtPeriodEnd), OR
    //   - they cancelled but the period hasn't elapsed yet
    //     (currentPeriodEnd > now) — Apple HIG requires honouring
    //     paid access until the period closes, and this is the
    //     branch the previous code missed: cancel_at_period_end
    //     users got dumped into the `free` default below and hit
    //     the 3-sub limit despite having paid Team/Pro access.
    const periodStillActive =
      !!user.currentPeriodEnd && new Date(user.currentPeriodEnd) > now;
    const hasOwnPro =
      user.billingSource === 'revenuecat' &&
      (user.plan === 'pro' || user.plan === 'organization') &&
      (!user.cancelAtPeriodEnd || periodStillActive);

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

  /**
   * Cascade an organization-owner's expiration to every ACTIVE workspace
   * member. Each member transitions through the state machine:
   *   - member with their own active RC sub       → snapshot unchanged
   *     (transition returns `s` because `memberHasOwnSub: true`)
   *   - member relying on owner's org sub         → grace_team for 7 days
   *
   * Runs inside the caller's transaction so the owner transition + member
   * cascade commit atomically.
   */
  private async handleTeamOwnerExpiration(
    m: EntityManager,
    owner: User,
  ): Promise<void> {
    const workspace = await m.findOne(Workspace, { where: { ownerId: owner.id } });
    if (!workspace) return;
    workspace.expiredAt = new Date();
    await m.save(workspace);

    const members = await m.find(WorkspaceMember, {
      where: { workspaceId: workspace.id, status: 'ACTIVE' as any },
    });

    for (const member of members) {
      if (member.userId === owner.id) continue;
      const current = await this.userBilling.read(member.userId).catch(() => null);
      if (!current) continue;
      const memberHasOwnSub =
        current.billingSource === 'revenuecat' &&
        current.state === 'active' &&
        !current.cancelAtPeriodEnd;
      await this.userBilling.applyTransition(
        member.userId,
        { type: 'TEAM_OWNER_EXPIRED', memberHasOwnSub },
        { actor: 'webhook_rc', manager: m },
      );
    }
    this.logger.log(
      `Team owner ${owner.id} expired — cascaded to ${members.length} members`,
    );
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
  /**
   * Enrich the already-claimed webhook_events row with the resolved user
   * id, provider event type, and final error text. Called after a handler
   * completes (success -> error=null) or fails (error=err.message) so
   * the reconciliation cron can find unprocessed events via the
   * partial index `idx_webhook_events_user_error`.
   *
   * Best-effort — never throws. The billing write has already committed
   * (or rolled back) by the time we reach here; a missed enrichment is
   * preferable to failing the webhook response.
   */
  async updateWebhookEventMeta(
    provider: string,
    eventId: string,
    userId: string | null,
    eventType: string | null,
    error: string | null,
  ): Promise<void> {
    if (!eventId) return;
    try {
      await this.webhookEventRepo.update(
        { provider, eventId },
        { userId, eventType, error: error ? error.slice(0, 2000) : null },
      );
    } catch (err) {
      this.logger.warn(
        `updateWebhookEventMeta failed (${provider}/${eventId}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async claimWebhookEvent(
    provider: string,
    eventId: string,
    eventType?: string | null,
  ): Promise<boolean> {
    if (!eventId) {
      // Without a stable event_id we can't dedupe — just let it through
      // and rely on downstream idempotency of the individual operations.
      this.logger.warn(`claimWebhookEvent: missing eventId for provider=${provider}`);
      return true;
    }
    try {
      // Write event_type on INSERT so we have observability even when the
      // handler bails early (anonymous user, user-not-found, processing
      // crash before updateWebhookEventMeta) — previously event_type stayed
      // NULL on those paths and the reconciliation cron lost its grip on
      // which webhooks need replay.
      await this.webhookEventRepo.insert({
        provider,
        eventId,
        eventType: eventType ?? null,
      });
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

    const claimed = await this.claimWebhookEvent('lemon_squeezy', eventId, event);
    if (!claimed) return;

    // Resolve local user id from LS customer email — best effort; the
    // handler itself tolerates missing users, but for the reconciliation
    // cron we want webhook_events.user_id populated whenever possible.
    let resolvedUserId: string | null = null;
    if (email) {
      const u = await this.usersService.findByEmail(email).catch(() => null);
      resolvedUserId = u?.id ?? null;
    }

    try {
      await this.handleWebhook(event, data);
      await this.updateWebhookEventMeta('lemon_squeezy', eventId, resolvedUserId, event, null);
    } catch (err) {
      this.logger.error(
        `Lemon Squeezy webhook ${event} failed: ${err instanceof Error ? err.stack : err}`,
      );
      const msg = err instanceof Error ? err.message : String(err);
      await this.updateWebhookEventMeta(
        'lemon_squeezy',
        eventId,
        resolvedUserId,
        event,
        msg,
      );
      // Roll back the idempotency record so LS retries on the next delivery.
      await this.webhookEventRepo
        .delete({ provider: 'lemon_squeezy', eventId })
        .catch(() => undefined);
      await this.alertWebhookFailure('lemon_squeezy', event, email, err);
      throw err;
    }
  }

  /**
   * Entry point invoked for every Lemon Squeezy event after idempotency
   * dedupe. Runs the event through the billing state machine so:
   *   - we write plan/state/billingSource atomically with the audit row
   *     and the amplitude outbox enqueue;
   *   - unmapped statuses (`on_trial`, refunded) fall through without
   *     touching the user plan — exactly like the old handler;
   *   - `order_created` stays a no-op (logged).
   *
   * Pro-invite seat cleanup on cancellation runs AFTER the main tx to
   * avoid re-nesting `downgradeInviteeIfEligible`'s own pessimistic-lock
   * transaction.
   */
  async handleWebhook(event: string, data: any) {
    this.logger.log(`Lemon Squeezy webhook: ${event}`);

    if (event === 'order_created') {
      this.logger.log('Order created:', data?.id);
      return;
    }

    const email: string | undefined = data?.attributes?.user_email;
    const customerId = data?.attributes?.customer_id;
    const variantId = String(data?.attributes?.variant_id ?? '');
    const status = data?.attributes?.status;

    if (!email) return;
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      this.logger.warn(`LS ${event}: user ${maskEmail(email)} not found`);
      return;
    }

    const billingEvent = mapLSEventToBillingEvent(event, data);
    if (!billingEvent) {
      this.logger.log(`LS ${event} skipped (no state-machine mapping, status=${status})`);
      return;
    }

    let previousPlan: string | null = null;
    let nextPlan: string | null = null;
    let inviteeEmailToRevoke: string | null = null;

    await this.dataSource.transaction(async (m) => {
      const current = await this.userBilling.read(user.id);
      const result = await this.userBilling.applyTransition(
        user.id,
        billingEvent,
        { actor: 'webhook_ls', manager: m },
      );
      if (!result.applied) {
        if (result.reason === 'invalid_transition') {
          this.logger.warn(
            `LS ${event} invalid transition from ${result.from} for user ${user.id}`,
          );
          await this.audit.log({
            userId: user.id,
            action: 'billing.webhook.invalid_transition',
            resourceType: 'user',
            resourceId: user.id,
            metadata: {
              provider: 'lemon_squeezy',
              event,
              from: result.from,
              variantId,
              error: 'invalid_transition',
            },
          });
        }
        return;
      }
      const next = result.snapshot;
      // Sync the in-memory user with the freshly-written row so downstream
      // code (audit/outbox/customer-id update) sees the new state.
      const refreshed = await m.findOne(User, { where: { id: user.id } });
      if (refreshed) Object.assign(user, refreshed);
      previousPlan = current.plan;
      nextPlan = next.plan;

      // Persist the LS customer id so we can cross-reference in future
      // deliveries — the state machine doesn't own this column.
      if (customerId && !user.lemonSqueezyCustomerId) {
        await m.update(User, user.id, { lemonSqueezyCustomerId: String(customerId) });
        user.lemonSqueezyCustomerId = String(customerId);
      }

      await this.audit.log({
        userId: user.id,
        action: 'billing.webhook.state_transition',
        resourceType: 'user',
        resourceId: user.id,
        metadata: {
          provider: 'lemon_squeezy',
          event,
          from: current.state,
          to: next.state,
          previousPlan: current.plan,
          nextPlan: next.plan,
          variantId,
          lemonSqueezyStatus: status,
        },
      });

      if (
        next.state !== current.state ||
        next.plan !== current.plan ||
        next.billingSource !== current.billingSource
      ) {
        await this.outbox.enqueue(
          'amplitude.track',
          {
            event: this.amplitudeEventForLS(event),
            userId: user.id,
            properties: {
              planBefore: current.plan,
              planAfter: next.plan,
              stateBefore: current.state,
              stateAfter: next.state,
              source: 'lemon_squeezy',
              variantId,
            },
          },
          m,
        );
      }

      // Queue invitee revocation for AFTER the tx commits.
      if (billingEvent.type === 'LS_SUBSCRIPTION_CANCELLED' && user.proInviteeEmail) {
        inviteeEmailToRevoke = user.proInviteeEmail;
        await m.update(User, user.id, { proInviteeEmail: null as any });
        user.proInviteeEmail = null as any;
      }
    });

    this.logger.log(
      `LS ${event}: user ${user.id} ${previousPlan ?? '?'} → ${nextPlan ?? '?'} (variant=${variantId})`,
    );

    if (inviteeEmailToRevoke) {
      await this.downgradeInviteeIfEligible(inviteeEmailToRevoke);
    }
  }

  async handleRevenueCatWebhook(body: any): Promise<void> {
    const event = body?.event;
    if (!event) return;

    const type: string = event.type;
    const appUserId: string = event.app_user_id;
    const productId: string = event.product_id;

    // Reject sandbox events when running in production. Without this guard
    // a developer with a TestFlight build pointed at the prod backend can
    // emit an INITIAL_PURCHASE for a free Apple sandbox account and the
    // prod DB will happily upgrade them to Pro. The override env var
    // ALLOW_RC_SANDBOX exists so we can intentionally accept sandbox in
    // staging/dev environments that share a webhook URL.
    const env = (event.environment ?? '').toUpperCase();
    const isSandbox = env === 'SANDBOX';
    const isProdNode = (this.cfg.get<string>('NODE_ENV', '') || '').toLowerCase() === 'production';
    const allowSandboxOverride = (this.cfg.get<string>('ALLOW_RC_SANDBOX', '') || '').toLowerCase() === 'true';
    if (isSandbox && isProdNode && !allowSandboxOverride) {
      this.logger.warn(
        `RevenueCat: ignoring SANDBOX event ${type} (app_user_id=${appUserId}) on production`,
      );
      return;
    }

    // RC provides a stable `event.id` on every delivery.
    const eventId: string =
      event.id ||
      (type && appUserId ? `${type}:${appUserId}:${event.event_timestamp_ms ?? ''}` : '');

    if (!appUserId || appUserId.startsWith('$RCAnonymousID')) {
      this.logger.warn(`RevenueCat webhook: anonymous user, type: ${type}`);
      return;
    }

    const claimed = await this.claimWebhookEvent('revenuecat', eventId, type);
    if (!claimed) return;

    const user = await this.usersService.findById(appUserId).catch(() => null);
    if (!user) {
      this.logger.warn(`RevenueCat webhook: user ${appUserId} not found`);
      // Stamp user_id=null but keep event_type so the row remains diagnostic.
      await this.updateWebhookEventMeta('revenuecat', eventId, null, type, 'user_not_found');
      return;
    }

    try {
      await this.processRevenueCatEvent(event as RCRawEvent, user);
      await this.updateWebhookEventMeta('revenuecat', eventId, user.id, type, null);
    } catch (err) {
      this.logger.error(
        `RevenueCat webhook ${type} failed: ${err instanceof Error ? err.stack : err}`,
      );
      const msg = err instanceof Error ? err.message : String(err);
      await this.updateWebhookEventMeta('revenuecat', eventId, user.id, type, msg);
      // Roll back idempotency record so RC retries on the next delivery.
      await this.webhookEventRepo
        .delete({ provider: 'revenuecat', eventId })
        .catch(() => undefined);
      await this.alertWebhookFailure('revenuecat', type, user.email, err);
      throw err;
    }
  }


  private amplitudeEventForRC(rcType: string, billingEventType?: string): string {
    // Refunds enter the webhook handler as `CANCELLATION` (with
    // cancellation_reason='REFUNDED') and are mapped to RC_REFUND by the
    // event-mapper. Without honouring the mapped type we'd report all
    // refunds as plain cancellations in Amplitude — analytics can't
    // distinguish "user cancelled at period end" from "Apple reversed
    // the charge", and chargeback rate becomes invisible.
    if (billingEventType === 'RC_REFUND') {
      return 'billing.subscription_refunded';
    }
    const map: Record<string, string> = {
      INITIAL_PURCHASE: 'billing.subscription_purchased',
      RENEWAL: 'billing.subscription_renewed',
      NON_RENEWING_PURCHASE: 'billing.subscription_renewed',
      PRODUCT_CHANGE: 'billing.product_changed',
      CANCELLATION: 'billing.subscription_cancelled',
      UNCANCELLATION: 'billing.subscription_uncancelled',
      EXPIRATION: 'billing.subscription_expired',
      BILLING_ISSUE: 'billing.billing_issue_started',
    };
    return map[rcType] ?? 'billing.event';
  }

  private amplitudeEventForLS(eventName: string): string {
    const map: Record<string, string> = {
      subscription_created: 'billing.subscription_purchased',
      subscription_updated: 'billing.subscription_updated',
      subscription_cancelled: 'billing.subscription_cancelled',
    };
    return map[eventName] ?? 'billing.event';
  }

  /**
   * Process a single RevenueCat webhook event through the billing state
   * machine. All side effects (DB update, audit row, amplitude outbox
   * enqueue, team-owner cascade, workspace reactivation, trial record)
   * commit in one transaction so we never leak "half-applied" state.
   *
   * Trial activation is a deliberate exception: it runs in its own inner
   * transaction (via TrialsService.activate) which is allowed to fail
   * (trial already consumed) without blocking the parent webhook. That's
   * why we wrap it in try/catch.
   */
  private async processRevenueCatEvent(
    event: RCRawEvent,
    user: User,
  ): Promise<void> {
    const billingEvent = mapRCEventToBillingEvent(event);
    if (!billingEvent) {
      this.logger.log(
        `RevenueCat: ${event.type} skipped (no state-machine mapping)`,
      );
      return;
    }

    await this.dataSource.transaction(async (m) => {
      const current = await this.userBilling.read(user.id);
      const result = await this.userBilling.applyTransition(
        user.id,
        billingEvent,
        { actor: 'webhook_rc', manager: m },
      );
      if (!result.applied) {
        if (result.reason === 'invalid_transition') {
          // Invalid transitions for RC are usually duplicate/late deliveries
          // (e.g. CANCELLATION after EXPIRATION). Log + audit but don't fail
          // the webhook — RC would keep retrying forever otherwise.
          this.logger.warn(
            `RC ${event.type} invalid transition from ${result.from} for user ${user.id}`,
          );
          await this.audit.log({
            userId: user.id,
            action: 'billing.webhook.invalid_transition',
            resourceType: 'user',
            resourceId: user.id,
            metadata: {
              provider: 'revenuecat',
              event: event.type,
              from: result.from,
              productId: event.product_id ?? null,
              error: 'invalid_transition',
            },
          });
        }
        return;
      }
      const next = result.snapshot;
      // Refresh in-memory user with the freshly-written row so the rest of
      // the handler (workspace reactivation, downgradedAt, audit, outbox)
      // sees the new state.
      const refreshed = await m.findOne(User, { where: { id: user.id } });
      if (refreshed) Object.assign(user, refreshed);

      // Reactivate owner's workspace on purchase / renewal / uncancellation —
      // a previous EXPIRATION may have marked it expired.
      if (
        billingEvent.type === 'RC_INITIAL_PURCHASE' ||
        billingEvent.type === 'RC_RENEWAL' ||
        billingEvent.type === 'RC_UNCANCELLATION' ||
        billingEvent.type === 'RC_PRODUCT_CHANGE'
      ) {
        const ownedWs = await m.findOne(Workspace, { where: { ownerId: user.id } });
        if (ownedWs && ownedWs.expiredAt) {
          ownedWs.expiredAt = null;
          await m.save(ownedWs);
        }
      }

      // Expiration cascades to team members if the user is an organization owner.
      if (billingEvent.type === 'RC_EXPIRATION' && current.plan === 'organization') {
        await this.handleTeamOwnerExpiration(m, user);
      }

      // Mark downgradedAt on EXPIRATION for downstream analytics.
      if (billingEvent.type === 'RC_EXPIRATION') {
        await m.update(User, user.id, { downgradedAt: new Date() });
        user.downgradedAt = new Date();
      }

      // Refunds get a localized FCM push so the user understands why
      // their access vanished. Pre-Phase-2 the user would silently lose
      // Pro and never know it was a refund vs an ordinary expiration.
      // Enqueued through the transactional outbox so a rollback above
      // (e.g. workspace save fails) doesn't leak a misleading push.
      if (billingEvent.type === 'RC_REFUND' && user.fcmToken) {
        const { title, body } = pushT(user.locale).refundProcessed();
        await this.outbox.enqueue(
          'fcm.push',
          {
            token: user.fcmToken,
            title,
            body,
            data: { type: 'refund_processed' },
            userId: user.id,
          },
          m,
        );
      }

      await this.audit.log({
        userId: user.id,
        action: 'billing.webhook.state_transition',
        resourceType: 'user',
        resourceId: user.id,
        metadata: {
          provider: 'revenuecat',
          event: event.type,
          from: current.state,
          to: next.state,
          previousPlan: current.plan,
          nextPlan: next.plan,
          productId: event.product_id ?? null,
        },
      });

      if (
        next.state !== current.state ||
        next.plan !== current.plan ||
        next.cancelAtPeriodEnd !== current.cancelAtPeriodEnd
      ) {
        await this.outbox.enqueue(
          'amplitude.track',
          {
            event: this.amplitudeEventForRC(event.type, billingEvent.type),
            userId: user.id,
            properties: {
              planBefore: current.plan,
              planAfter: next.plan,
              stateBefore: current.state,
              stateAfter: next.state,
              source: 'revenuecat',
              productId: event.product_id ?? null,
            },
          },
          m,
        );
      }
    });

    // Trial activation for RC intro/trial offers — runs OUTSIDE the main
    // transaction because TrialsService manages its own tx (with a
    // pessimistic lock on the user_trials row) and a ConflictException
    // from a duplicate trial must not roll back the state-machine write
    // that already committed above.
    if (
      event.type === 'INITIAL_PURCHASE' &&
      (event.period_type === 'TRIAL' || event.period_type === 'INTRO')
    ) {
      const plan = RC_PRODUCT_TO_PLAN_MAP[event.product_id ?? ''];
      if (plan) {
        try {
          await this.trialsService.activate(user.id, 'revenuecat_intro', plan);
        } catch (err) {
          this.logger.log(
            `RC trial activation skipped for ${user.id}: ${(err as Error).message}`,
          );
        }
      }
    }

    this.logger.log(
      `RevenueCat: ${event.type} processed for user ${user.id} (product=${event.product_id ?? 'n/a'})`,
    );
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

      // billing fields are owned by the state machine; only non-billing
      // book-keeping (invitedByUserId / proInviteeEmail) goes through `m.save`.
      invitee.invitedByUserId = owner.id;
      owner.proInviteeEmail = email;
      await m.save([owner, invitee]);

      await this.userBilling.applyTransition(
        invitee.id,
        { type: 'ADMIN_GRANT_PRO', plan: 'pro', invitedByUserId: owner.id },
        { actor: 'admin_grant', manager: m },
      );

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
      invitee.invitedByUserId = null;
      await m.save(invitee);

      // billing fields owned by the state machine — TRIAL_EXPIRED is the
      // canonical "drop to free + clear period" verb for non-RC paid rows.
      await this.userBilling.applyTransition(
        invitee.id,
        { type: 'TRIAL_EXPIRED' },
        { actor: 'admin_grant', manager: m },
      );

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

  /**
   * Fetch RC's subscriber view and shape it into the framework-agnostic
   * RCSubscriberSnapshot the state-machine helpers consume. Throws 503
   * when the API is unreachable so callers don't silently degrade — RC
   * is mandatory for plan-grant authentication.
   */
  private async fetchRcSubscriberSnapshot(
    userId: string,
  ): Promise<RCSubscriberSnapshot> {
    const apiKey =
      this.cfg.get<string>('REVENUECAT_API_KEY_SECRET', '') ||
      this.cfg.get<string>('REVENUECAT_API_KEY', '');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Billing verification is temporarily unavailable. Please try again later.',
      );
    }
    let res: Response;
    try {
      res = await fetch(
        `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
        { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } },
      );
    } catch (e) {
      this.logger.error(`fetchRcSubscriberSnapshot: RC fetch failed: ${e}`);
      throw new ServiceUnavailableException(
        'Billing verification is temporarily unavailable. Please try again later.',
      );
    }
    if (!res.ok) {
      this.logger.warn(
        `fetchRcSubscriberSnapshot: RC returned ${res.status} for user ${userId}`,
      );
      throw new ServiceUnavailableException(
        'Billing verification is temporarily unavailable. Please try again later.',
      );
    }
    const data = await res.json();
    const ents = data?.subscriber?.entitlements ?? {};
    const subs = data?.subscriber?.subscriptions ?? {};
    const now = Date.now();
    const entitlements: Record<
      string,
      { expiresAt: Date | null; productId: string; willRenew?: boolean }
    > = {};
    let latestExpirationMs: number | null = null;
    for (const [name, value] of Object.entries(ents) as [string, any][]) {
      const expRaw = value?.expires_date;
      const expMs =
        typeof expRaw === 'number'
          ? expRaw
          : expRaw
            ? Date.parse(String(expRaw))
            : NaN;
      if (!isNaN(expMs) && expMs > now) {
        const productId = String(value?.product_identifier ?? '');
        // Look up the underlying subscription for this exact product to
        // know whether THIS specific entitlement is renewing — the user
        // may have a cancelled Team running side-by-side with a freshly
        // purchased Pro. Without per-entitlement granularity our picker
        // would always prefer Team and the Pro purchase would never
        // surface in /billing/me.
        const sub = productId ? subs[productId] : null;
        const willRenew = sub ? !sub?.unsubscribe_detected_at : undefined;
        entitlements[name] = {
          expiresAt: new Date(expMs),
          productId,
          willRenew,
        };
        if (latestExpirationMs == null || expMs > latestExpirationMs) {
          latestExpirationMs = expMs;
        }
      }
    }
    // `cancelAtPeriodEnd` must reflect ONLY the currently-active
    // entitlement(s). Iterating ALL of `subs` (including products that
    // already expired or were superseded) tripped on a user's historical
    // Pro cancellation and falsely flagged a freshly-purchased Team as
    // cancel_at_period_end — surfacing an expiration banner under a
    // fully-paid, auto-renewing Team subscription. Restrict the lookup
    // to product IDs we just confirmed are still active above.
    const activeProductIds = new Set(
      Object.values(entitlements)
        .map((e) => e.productId)
        .filter((pid): pid is string => !!pid),
    );
    const cancelAtPeriodEnd = Object.entries(subs).some(
      ([pid, s]: [string, any]) =>
        activeProductIds.has(pid) && s && s.unsubscribe_detected_at,
    );
    const billingIssueDetectedAt = Object.values(subs)
      .map((s: any) => s?.billing_issues_detected_at)
      .filter(Boolean)
      .map((v: any) => new Date(String(v)))
      .reduce<Date | null>((acc, d) => (!acc || d > acc ? d : acc), null);
    return { entitlements, latestExpirationMs, cancelAtPeriodEnd, billingIssueDetectedAt };
  }

  async syncRevenueCat(userId: string, productId: string): Promise<void> {
    const rc = await this.fetchRcSubscriberSnapshot(userId);

    // Require the requested product (or its tier) to actually be present in
    // RC, otherwise the client is asking us to grant access we can't verify.
    const lowerProductId = productId.toLowerCase();
    const isOrgTier = lowerProductId.includes('team') || lowerProductId.includes('org');
    const matches = Object.entries(rc.entitlements).some(([name, ent]) => {
      const lcName = name.toLowerCase();
      if (ent.productId === productId) return true;
      if (isOrgTier) return lcName.includes('team') || lcName.includes('org');
      return lcName.includes('pro') || lcName.includes('premium');
    });
    if (!matches) {
      const seen = Object.keys(rc.entitlements).join(',') || '<none>';
      this.logger.warn(
        `syncRevenueCat: user ${userId} has no active entitlement matching product=${productId}; RC returned [${seen}]`,
      );
      throw new ForbiddenException(
        'No active RevenueCat entitlement found for this account.',
      );
    }

    const current = await this.userBilling.read(userId);
    const event = inferEventFromRcSnapshot(rc, current, productId);
    if (!event) {
      this.logger.log(`syncRevenueCat: user ${userId} already in sync`);
      return;
    }
    await this.userBilling.applyTransition(userId, event, { actor: 'sync' });
    this.logger.log(`syncRevenueCat: user ${userId} → ${event.type}`);
  }

  /**
   * Reconcile a user's stored billing state with RevenueCat's source-of-truth
   * entitlements. Used when the mobile client notices a drift (RC says no
   * active entitlements but `/billing/me` still reports a paid plan) — most
   * commonly because an EXPIRATION webhook was lost or never delivered, or
   * because the user was granted a plan manually before RC integration.
   *
   * - billingSource not 'revenuecat'                    → no-op
   * - user already on free                              → no-op
   * - RC has any active entitlement                     → no-op (drift was a false alarm)
   * - RC empty + currentPeriodEnd in the future         → flag cancelAtPeriodEnd
   *   (subscription was cancelled in Apple Settings; access stays till period ends)
   * - RC empty + period elapsed / unknown               → wipe paid state to free
   */
  async reconcileRevenueCat(userId: string): Promise<{
    // 'upgraded' added for forward-compat — old mobile clients only branch
    // on `ran = action !== 'noop'`, so a new value is safe and additive.
    action: 'noop' | 'cancel_at_period_end' | 'downgraded' | 'upgraded';
    reason: string;
  }> {
    const current = await this.userBilling.read(userId);
    if (current.billingSource !== 'revenuecat') {
      return { action: 'noop', reason: `billingSource=${current.billingSource ?? 'null'}` };
    }
    // Removed the `state === 'free'` short-circuit. Apple is the source
    // of truth: a user can be on `free` locally but have a fresh active
    // entitlement on the App Store (e.g. Restore Purchases hasn't fired
    // yet, or a webhook was lost). Letting `inferEventFromRcSnapshot`
    // run lets us emit RC_INITIAL_PURCHASE in those cases. Same goes
    // for grace states (handled in the inferrer).

    let rc: RCSubscriberSnapshot;
    try {
      rc = await this.fetchRcSubscriberSnapshot(userId);
    } catch (e: any) {
      this.logger.warn(
        `reconcileRevenueCat: RC fetch failed for ${userId}: ${e?.message}`,
      );
      return { action: 'noop', reason: 'rc_fetch_failed' };
    }

    const event = inferEventFromRcSnapshot(rc, current);
    if (!event) return { action: 'noop', reason: 'rc_in_sync' };

    const result = await this.userBilling.applyTransition(userId, event, {
      actor: 'reconcile',
    });
    if (!result.applied) return { action: 'noop', reason: result.reason };

    if (event.type === 'RC_CANCELLATION') {
      this.logger.log(
        `reconcileRevenueCat: user ${userId} → cancel_at_period_end`,
      );
      return { action: 'cancel_at_period_end', reason: event.type };
    }
    if (event.type === 'RC_EXPIRATION') {
      this.logger.log(`reconcileRevenueCat: user ${userId} → grace_pro`);
      return { action: 'downgraded', reason: event.type };
    }
    if (
      event.type === 'RC_INITIAL_PURCHASE' ||
      event.type === 'RC_PRODUCT_CHANGE' ||
      event.type === 'RC_RENEWAL'
    ) {
      this.logger.log(
        `reconcileRevenueCat: user ${userId} synced from RC (${event.type})`,
      );
      return { action: 'upgraded', reason: event.type };
    }
    return { action: 'noop', reason: event.type };
  }

  async cancelSubscription(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    const current = await this.userBilling.read(userId);
    this.logger.log(
      `cancelSubscription: user ${userId} state=${current.state} plan=${current.plan} source=${current.billingSource ?? 'null'}`,
    );

    if (current.state === 'free') {
      this.logger.warn(`cancelSubscription: user ${userId} already on free plan`);
      return;
    }

    // Backend-only trial (no RC/LS sub yet) — TRIAL_EXPIRED resets the
    // billing snapshot. Trial bookkeeping (trialEndDate) lives outside
    // the state machine and is cleared via usersService.
    const isOnBackendTrial =
      user.trialEndDate &&
      new Date(user.trialEndDate) > new Date() &&
      current.billingSource !== 'revenuecat' &&
      current.billingSource !== 'lemon_squeezy';
    if (isOnBackendTrial) {
      await this.userBilling.applyTransition(
        userId,
        { type: 'TRIAL_EXPIRED' },
        { actor: 'user_cancel' },
      );
      await this.usersService.update(userId, { trialEndDate: undefined as any });
      this.logger.log(`cancelSubscription: trial cancelled for user ${userId}`);
      return;
    }

    if (current.billingSource === 'revenuecat') {
      await this.userBilling.applyTransition(
        userId,
        {
          type: 'RC_CANCELLATION',
          periodEnd: current.currentPeriodEnd ?? new Date(),
        },
        { actor: 'user_cancel' },
      );
      this.logger.log(
        `cancelSubscription: RC subscription marked cancel-at-period-end for user ${userId}`,
      );
      return;
    }

    if (current.billingSource === 'lemon_squeezy') {
      await this.userBilling.applyTransition(
        userId,
        { type: 'LS_SUBSCRIPTION_CANCELLED' },
        { actor: 'user_cancel' },
      );
      this.logger.log(
        `cancelSubscription: LS subscription cancelled for user ${userId}`,
      );
      return;
    }

    // Legacy admin grant — no billing source but plan != free.
    // TRIAL_EXPIRED resets the snapshot to free + clears period.
    await this.userBilling.applyTransition(
      userId,
      { type: 'TRIAL_EXPIRED' },
      { actor: 'user_cancel' },
    );
    this.logger.log(
      `cancelSubscription: legacy paid plan cancelled for user ${userId}`,
    );
  }
}
