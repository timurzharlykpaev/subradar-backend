import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { BillingService } from '../../billing/billing.service';

@Injectable()
export class AnalysisPlanGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @Inject(forwardRef(() => BillingService))
    private readonly billingService: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const jwtUser = request.user;

    const user = await this.usersRepo.findOne({ where: { id: jwtUser.id } });
    if (!user) throw new ForbiddenException('User not found');

    const effective = await this.billingService.getEffectiveAccess(user);
    if (effective.plan === 'pro' || effective.plan === 'organization') {
      return true;
    }

    throw new ForbiddenException({ error: 'PLAN_REQUIRED', requiredPlan: 'pro' });
  }
}
