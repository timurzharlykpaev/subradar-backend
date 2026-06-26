import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Base throttler guard that skips rate limiting for the seeded E2E test
 * accounts (`review@subradar.ai`, `*@subradar.test`) — but ONLY when the
 * review-account bypass is enabled (`ENABLE_REVIEW_ACCOUNT=true`), which is
 * dev/sandbox only. Prod keeps the full throttle because the flag is off.
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
    if (process.env.ENABLE_REVIEW_ACCOUNT === 'true') {
      const req = context.switchToHttp().getRequest();
      const email = String(req?.body?.email ?? '').trim().toLowerCase();
      if (email === 'review@subradar.ai' || email.endsWith('@subradar.test')) {
        return true;
      }
    }
    return super.shouldSkip(context);
  }
}
