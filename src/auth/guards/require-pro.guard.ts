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
    const allowed = access.plan === 'pro' || access.plan === 'organization';

    if (!allowed) {
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
