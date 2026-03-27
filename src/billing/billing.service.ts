import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { UsersService } from '../users/users.service';
import { PLANS, PLAN_DETAILS } from './plans.config';

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

  private readonly RC_PRODUCT_TO_PLAN: Record<string, string> = {
    'io.subradar.mobile.pro.monthly': 'pro',
    'io.subradar.mobile.pro.yearly': 'pro',
    'io.subradar.mobile.team.monthly': 'organization',
    'io.subradar.mobile.team.yearly': 'organization',
  };

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const hmac = createHmac('sha256', this.webhookSecret);
    const digest = hmac.update(payload).digest('hex');
    const digestBuf = Buffer.from(digest);
    const signatureBuf = Buffer.from(signature);
    if (digestBuf.length !== signatureBuf.length) return false;
    return timingSafeEqual(digestBuf, signatureBuf);
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
            const updates: any = {
              plan: isActive ? (isTeam ? 'organization' : 'pro') : 'free',
              lemonSqueezyCustomerId: String(customerId),
              billingSource: 'lemon_squeezy',
            };
            this.logger.log(`Webhook upgrade: email=${email} variantId=${variantId} isTeam=${isTeam} plan=${updates.plan} status=${status}`);
            await this.usersService.update(user.id, updates);
          }
        }
        break;
      }
      case 'subscription_cancelled': {
        const email = data?.attributes?.user_email;
        if (email) {
          const user = await this.usersService.findByEmail(email);
          if (user) {
            await this.usersService.update(user.id, { plan: 'free' });
            if (user.proInviteeEmail) {
              const invitee = await this.usersService.findByEmail(user.proInviteeEmail);
              if (invitee) {
                await this.usersService.update(invitee.id, { plan: 'free' });
              }
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

    if (!appUserId || appUserId.startsWith('$RCAnonymousID')) {
      this.logger.warn(`RevenueCat webhook: anonymous user, type: ${type}`);
      return;
    }

    const user = await this.usersService.findById(appUserId).catch(() => null);
    if (!user) {
      this.logger.warn(`RevenueCat webhook: user ${appUserId} not found`);
      return;
    }

    switch (type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE': {
        const plan = this.RC_PRODUCT_TO_PLAN[productId] || 'pro';
        user.plan = plan;
        user.billingSource = 'revenuecat';
        await this.usersService.save(user);
        this.logger.log(`RevenueCat: ${type} — user ${appUserId} → plan ${plan}`);
        break;
      }
      case 'CANCELLATION': {
        this.logger.log(`RevenueCat: CANCELLATION — user ${appUserId}`);
        break;
      }
      case 'EXPIRATION': {
        user.plan = 'free';
        user.billingSource = null as any;
        await this.usersService.save(user);
        this.logger.log(`RevenueCat: EXPIRATION — user ${appUserId} → free`);
        break;
      }
      case 'BILLING_ISSUE': {
        this.logger.warn(`RevenueCat: BILLING_ISSUE — user ${appUserId}`);
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
    this.logger.log(`Creating checkout: plan=${planIdOrVariantId} variantId=${variantId} billing=${billing} email=${email}`);

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

  async activateProInvite(ownerId: string, inviteeEmail: string): Promise<void> {
    const owner = await this.usersService.findById(ownerId);
    if (owner.plan !== 'pro' && owner.plan !== 'organization') {
      throw new ForbiddenException('Only Pro or Organization users can send invites');
    }
    if (owner.plan === 'pro' && owner.proInviteeEmail) {
      throw new BadRequestException('You already have an active invite. Remove it first.');
    }
    const invitee = await this.usersService.findByEmail(inviteeEmail);
    if (!invitee) {
      throw new NotFoundException(`User with email ${inviteeEmail} not found`);
    }
    if (invitee.id === ownerId) {
      throw new BadRequestException('You cannot invite yourself');
    }
    await this.usersService.update(invitee.id, { plan: 'pro' });
    await this.usersService.update(ownerId, { proInviteeEmail: inviteeEmail });
  }

  async removeProInvite(ownerId: string): Promise<void> {
    const owner = await this.usersService.findById(ownerId);
    if (!owner.proInviteeEmail) {
      throw new BadRequestException('No active invite to remove');
    }
    const invitee = await this.usersService.findByEmail(owner.proInviteeEmail);
    if (invitee) {
      await this.usersService.update(invitee.id, { plan: 'free' });
    }
    await this.usersService.update(ownerId, { proInviteeEmail: undefined as any });
  }

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async consumeAiRequest(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    const currentMonth = this.getCurrentMonth();
    const planConfig = PLANS[user.plan] ?? PLANS.free;

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
    const plan = this.RC_PRODUCT_TO_PLAN[productId];
    if (!plan) {
      this.logger.warn(`syncRevenueCat: unknown productId ${productId}`);
      throw new BadRequestException(`Unknown product: ${productId}`);
    }

    const user = await this.usersService.findById(userId);
    user.plan = plan;
    user.billingSource = 'revenuecat';
    await this.usersService.save(user);
    this.logger.log(`syncRevenueCat: user ${userId} → plan ${plan} (product: ${productId})`);
  }

  async getBillingInfo(userId: string, subscriptionCount: number) {
    const user = await this.usersService.findById(userId);
    const planConfig = PLANS[user.plan] ?? PLANS.free;
    const currentMonth = this.getCurrentMonth();

    const aiRequestsUsed =
      user.aiRequestsMonth === currentMonth ? user.aiRequestsUsed : 0;

    let trialDaysLeft: number | null = null;
    let status: 'active' | 'cancelled' | 'trialing' = 'active';

    // If user has a paid subscription via RevenueCat, they are always 'active'
    // regardless of any backend trial state (trial was superseded by real purchase)
    if (user.billingSource !== 'revenuecat' && user.trialEndDate) {
      const now = Date.now();
      const end = new Date(user.trialEndDate).getTime();
      if (end > now) {
        status = 'trialing';
        trialDaysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
      }
    }

    return {
      plan: user.plan,
      status,
      currentPeriodEnd: user.trialEndDate?.toISOString() ?? null,
      cancelAtPeriodEnd: false,
      trialUsed: user.trialUsed,
      trialDaysLeft,
      subscriptionCount,
      subscriptionLimit: planConfig.subscriptionLimit,
      aiRequestsUsed,
      aiRequestsLimit: planConfig.aiRequestsLimit,
      proInviteeEmail: user.proInviteeEmail ?? null,
    };
  }
}
