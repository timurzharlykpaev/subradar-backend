import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Response } from 'express';

/**
 * Global default for `Cache-Control`.
 *
 * Why this exists: most of our endpoints are user-specific (subscriptions,
 * billing/me, users/me, analytics/*). Without an explicit Cache-Control
 * header any caching layer in front of us — Cloudflare, ISP transparent
 * proxy, browser back-forward cache — is left to apply heuristics, and
 * those heuristics differ between vendors / over time. The safest answer
 * for an authenticated JSON API is to **say so explicitly**: `private`
 * (only the end-user's cache may store it) and `no-store` (don't store
 * it at all). Anyone who actually wants edge caching on a specific route
 * sets `@Header('Cache-Control', '...')` and we don't override.
 *
 * Why we set the header BEFORE next.handle() instead of in tap():
 *   - tap() only runs on the success path of the observable. If a guard
 *     (JwtAuthGuard) throws Unauthorized, or a route handler throws a
 *     domain error, the response leaves through the exception filter
 *     and tap() never fires — the response goes out without
 *     Cache-Control, defeating the whole point.
 *   - Setting it pre-handle puts the default on the response object
 *     immediately. `@Header(...)` on the route still overrides because
 *     Nest applies its decorator metadata after the handler returns,
 *     and the last `setHeader` wins.
 *
 * Backward compatibility: this is additive header-only — older mobile
 * binaries on the App Store ignore Cache-Control entirely (they manage
 * their own cache via TanStack Query staleTime), so deploying this
 * doesn't change behaviour for any user in the field.
 */
@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const res = context.switchToHttp().getResponse<Response>();
    if (!res.getHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'private, no-store');
    }
    return next.handle();
  }
}
