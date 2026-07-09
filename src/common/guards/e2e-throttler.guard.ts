import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { shouldSkipThrottle } from '../test-accounts';

/**
 * Base throttler guard that skips rate limiting for the reserved test/demo
 * account families — review@subradar.ai and `@subradar.test` (when
 * ENABLE_REVIEW_ACCOUNT=true), plus testN@subradar.ai (when
 * ENABLE_DEMO_ACCOUNTS=true). Real users always hit the full throttle. See
 * `test-accounts` for the gating matrix.
 *
 * Why a shared base: the auth routes are guarded by BOTH the global
 * `APP_GUARD` throttler (per-IP) and the route-level `EmailThrottlerGuard`
 * (per-email), and the route's `@Throttle(5/15min)` applies to both. The
 * Maestro suite logs in fresh ~65 times from a single IP, so skipping only the
 * per-email guard still trips the per-IP global one. Both guards extend this
 * base so the skip applies uniformly.
 */
@Injectable()
export class E2eAwareThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (shouldSkipThrottle(req?.body?.email)) {
      return true;
    }
    return super.shouldSkip(context);
  }
}
