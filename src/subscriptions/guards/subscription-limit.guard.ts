import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from '../entities/subscription.entity';
import { User } from '../../users/entities/user.entity';
import { PLANS } from '../../billing/plans.config';
import { BillingService } from '../../billing/billing.service';

// Use PLANS from billing config as single source of truth
export const PLAN_LIMITS = {
  free: { maxSubscriptions: PLANS.free.subscriptionLimit, maxAiRequests: PLANS.free.aiRequestsLimit },
  pro: { maxSubscriptions: PLANS.pro.subscriptionLimit ?? Infinity, maxAiRequests: PLANS.pro.aiRequestsLimit ?? 200 },
  organization: { maxSubscriptions: PLANS.organization?.subscriptionLimit ?? Infinity, maxAiRequests: PLANS.organization?.aiRequestsLimit ?? Infinity },
};

/**
 * Auth/plan presence guard for subscription creation.
 *
 * NOTE: Subscription limit enforcement lives in SubscriptionsService.create()
 * under a pg advisory lock + transaction — this avoids the read/write race
 * where concurrent requests both pass the count check before either writes.
 * The guard now only validates the caller and loads effective plan for downstream
 * handlers (kept for backward compatibility of the interceptor chain).
 */
@Injectable()
export class SubscriptionLimitGuard implements CanActivate {
  constructor(
    @InjectRepository(Subscription)
    private subscriptionsRepo: Repository<Subscription>,
    @InjectRepository(User)
    private usersRepo: Repository<User>,
    @Inject(forwardRef(() => BillingService))
    private readonly billingService: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const jwtUser = request.user;

    if (!jwtUser) return true;

    // JWT only contains {id, email} — load full user from DB to get current plan
    const user = await this.usersRepo.findOne({ where: { id: jwtUser.id } });
    if (!user) return true;

    // Touch billing service so trial-expired accounts get recomputed plan.
    // Actual limit is enforced transactionally in SubscriptionsService.create().
    await this.billingService.getEffectiveAccess(user).catch(() => null);

    return true;
  }
}
