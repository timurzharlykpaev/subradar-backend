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
import { PLANS } from '../../billing/plans.config';

export const PLAN_LIMITS = {
  free: { maxSubscriptions: 5, maxAiRequests: 10 },
  pro: { maxSubscriptions: Infinity, maxAiRequests: 200 },
  organization: { maxSubscriptions: Infinity, maxAiRequests: Infinity },
};

@Injectable()
export class SubscriptionLimitGuard implements CanActivate {
  constructor(
    @InjectRepository(Subscription)
    private subscriptionsRepo: Repository<Subscription>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

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
