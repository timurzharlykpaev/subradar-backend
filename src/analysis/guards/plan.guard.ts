import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class AnalysisPlanGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const jwtUser = request.user;

    const user = await this.usersRepo.findOne({ where: { id: jwtUser.id } });
    if (!user) throw new ForbiddenException('User not found');

    const plan = user.plan ?? 'free';

    if (plan === 'pro' || plan === 'organization') {
      if (user.cancelAtPeriodEnd && user.currentPeriodEnd) {
        const now = new Date();
        if (new Date(user.currentPeriodEnd) < now) {
          throw new ForbiddenException({ error: 'PLAN_REQUIRED', requiredPlan: 'pro' });
        }
      }
      return true;
    }

    if (user.trialEndDate) {
      const now = new Date();
      if (new Date(user.trialEndDate) > now) {
        return true;
      }
    }

    throw new ForbiddenException({ error: 'PLAN_REQUIRED', requiredPlan: 'pro' });
  }
}
