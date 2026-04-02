import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionStatus,
} from '../entities/subscription.entity';
import { User } from '../../users/entities/user.entity';
import { PLANS } from '../../billing/plans.config';

// Use PLANS from billing config as single source of truth
export const PLAN_LIMITS = {
  free: { maxSubscriptions: PLANS.free.subscriptionLimit, maxAiRequests: PLANS.free.aiRequestsLimit },
  pro: { maxSubscriptions: PLANS.pro.subscriptionLimit ?? Infinity, maxAiRequests: PLANS.pro.aiRequestsLimit ?? 200 },
  organization: { maxSubscriptions: PLANS.organization?.subscriptionLimit ?? Infinity, maxAiRequests: PLANS.organization?.aiRequestsLimit ?? Infinity },
};

@Injectable()
export class SubscriptionLimitGuard implements CanActivate {
  constructor(
    @InjectRepository(Subscription)
    private subscriptionsRepo: Repository<Subscription>,
    @InjectRepository(User)
    private usersRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const jwtUser = request.user;

    if (!jwtUser) return true;

    // JWT only contains {id, email} — load full user from DB to get current plan
    const user = await this.usersRepo.findOne({ where: { id: jwtUser.id } });
    if (!user) return true;

    const plan = user.plan ?? 'free';
    const planConfig = PLANS[plan as keyof typeof PLANS] ?? PLANS.free;

    // Use PLANS config as source of truth (subscriptionLimit null = unlimited)
    if (planConfig.subscriptionLimit === null) return true;

    const count = await this.subscriptionsRepo.count({
      where: [
        { userId: user.id, status: SubscriptionStatus.ACTIVE },
        { userId: user.id, status: SubscriptionStatus.TRIAL },
      ],
    });

    if (count >= planConfig.subscriptionLimit) {
      throw new ForbiddenException({
        error: {
          code: 'SUBSCRIPTION_LIMIT_REACHED',
          message_key: 'errors.subscription_limit_reached',
          limit: planConfig.subscriptionLimit,
          plan,
        },
      });
    }

    return true;
  }
}
