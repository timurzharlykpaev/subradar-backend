import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { BillingService } from '../../billing/billing.service';
import { UsersService } from '../../users/users.service';

/**
 * Server-side enforcement of Pro/Team-gated endpoints.
 *
 * Returns HTTP 402 (Payment Required) on Free users so the mobile client
 * can detect a race (Pro expired during a long-running flow) and route
 * to the paywall.
 *
 * Pairs with `@UseGuards(JwtAuthGuard, RequireProGuard)` — JwtAuthGuard
 * MUST run first so `req.user` is populated.
 *
 * Resurrected for Gmail bulk-scan (Batch 5). Originally introduced in
 * f1b046b, reverted in 8497663 because the feature was paused. Now the
 * feature is back, the guard is back. Plan check uses
 * BillingService.getEffectiveAccess so trial / grace-period states
 * resolve to the correct effective plan, not the raw `users.plan` field.
 */
@Injectable()
export class RequireProGuard implements CanActivate {
  private readonly logger = new Logger(RequireProGuard.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId = req.user?.id;
    if (!userId) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.UNAUTHORIZED);
    }

    const access = await this.billingService.getEffectiveAccess(user);
    // 'pro' and 'organization' (the team plan as per BillingService.types)
    // unlock the bulk Gmail scan. 'free' / 'trial' fall through to 402.
    const allowed = access.plan === 'pro' || access.plan === 'organization';

    if (!allowed) {
      this.logger.log(
        `RequireProGuard: 402 for user ${userId} (plan=${access.plan})`,
      );
      throw new HttpException(
        {
          code: 'PRO_PLAN_REQUIRED',
          message: 'This feature requires a Pro or Team plan',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return true;
  }
}
