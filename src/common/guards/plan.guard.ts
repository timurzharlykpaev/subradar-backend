import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EffectiveAccessResolver } from '../../billing/effective-access/effective-access.service';
import {
  PLAN_CAP_KEY,
  PlanCapability,
} from '../decorators/require-plan-capability.decorator';

/**
 * PlanGuard — enforces plan capability gates declared via
 * {@link RequirePlanCapability}. Must be composed AFTER JwtAuthGuard
 * (it relies on `req.user.id` being populated).
 *
 * Design notes:
 * - Handlers without the metadata pass through untouched, so slapping
 *   PlanGuard on a whole controller is safe — individual endpoints
 *   opt in by adding the decorator.
 * - Access is resolved through {@link EffectiveAccessResolver} so
 *   precedence rules (trial, grace, team membership) live in exactly
 *   one place. Don't re-read `user.plan` here.
 * - Error messages are user-facing; keep them stable since the mobile
 *   client may display them verbatim inside upgrade prompts.
 */
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly effective: EffectiveAccessResolver,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const cap = this.reflector.get<PlanCapability>(
      PLAN_CAP_KEY,
      ctx.getHandler(),
    );
    if (!cap) return true;

    const req = ctx.switchToHttp().getRequest();
    if (!req.user?.id) {
      throw new ForbiddenException('No user context');
    }

    const access = await this.effective.resolve(req.user.id);

    if (cap === 'canCreateOrg' && !access.limits.canCreateOrg) {
      throw new ForbiddenException('This action requires Organization plan');
    }
    if (cap === 'canInvite' && !access.limits.canInvite) {
      throw new ForbiddenException(
        'This action requires Pro or Organization plan',
      );
    }
    // unlimitedSubs is reserved for future endpoints — no gate wired yet.

    return true;
  }
}
