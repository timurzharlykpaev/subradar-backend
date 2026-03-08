import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
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

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const hmac = createHmac('sha256', this.webhookSecret);
    const digest = hmac.update(payload).digest('hex');
    return digest === signature;
  }

  async handleWebhook(event: string, data: any) {
    this.logger.log(`Lemon Squeezy webhook: ${event}`);

    switch (event) {
      case 'subscription_created':
      case 'subscription_updated': {
        const customerId = data?.attributes?.customer_id;
        const email = data?.attributes?.user_email;
        const status = data?.attributes?.status;
        if (email) {
          const user = await this.usersService.findByEmail(email);
          if (user) {
            const isTrialing = status === 'on_trial';
            const updates: any = {
              plan: status === 'active' || isTrialing ? 'pro' : 'free',
              lemonSqueezyCustomerId: String(customerId),
            };
            if (isTrialing && !user.trialUsed) {
              updates.trialUsed = true;
              updates.trialStartDate = new Date();
              updates.trialEndDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            }
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
    const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
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
          },
          relationships: {
            store: { data: { type: 'stores', id: this.storeId } },
            variant: { data: { type: 'variants', id: variantId } },
          },
        },
      }),
    });

    const result = (await response.json()) as any;
    return { url: result?.data?.attributes?.url };
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

  async getBillingInfo(userId: string, subscriptionCount: number) {
    const user = await this.usersService.findById(userId);
    const planConfig = PLANS[user.plan] ?? PLANS.free;
    const currentMonth = this.getCurrentMonth();

    const aiRequestsUsed =
      user.aiRequestsMonth === currentMonth ? user.aiRequestsUsed : 0;

    let trialDaysLeft: number | null = null;
    let status: 'active' | 'cancelled' | 'trialing' = 'active';

    if (user.trialEndDate) {
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
