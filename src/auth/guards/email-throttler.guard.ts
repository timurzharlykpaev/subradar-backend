import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Auth-specific throttler that keys on `req.body.email` instead of IP.
 *
 * Why: IP-based throttling is trivially bypassed (NAT, mobile carriers hop
 * IPs, VPN / Tor exit nodes), and conversely it wrongly penalises users
 * sharing an office / carrier-grade NAT. Credential-stuffing and OTP
 * enumeration attacks target *specific email addresses* — so the right
 * protection axis is per-email.
 *
 * Falls back to the stock IP tracker when:
 *   - body is missing (malformed request — let validation reject it)
 *   - email is absent or non-string (e.g. someone hits /login with a token
 *     DTO) — prevents attackers from dodging the limit by omitting `email`.
 *
 * Combined with the existing global ThrottlerGuard (300 req/min per IP), this
 * gives us defence in depth: volumetric abuse is caught at IP level, targeted
 * account abuse is caught at email level.
 */
@Injectable()
export class EmailThrottlerGuard extends ThrottlerGuard {
  /**
   * E2E escape hatch: when the review-account bypass is enabled (dev/sandbox
   * only — `ENABLE_REVIEW_ACCOUNT=true`), skip per-email auth throttling for the
   * seeded test accounts (`review@subradar.ai`, `*@subradar.test`). The Maestro
   * suite reinstalls the app and logs in fresh for every one of ~65 flows, which
   * blows the 5-per-15-min budget and makes runs flaky. Prod is unaffected: the
   * flag is off there, so real users keep the full throttle.
   */
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

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const email = req?.body?.email;
    if (typeof email === 'string' && email.length > 0) {
      // Normalise — lowercase & trim — so "User@x.com" and " user@x.com "
      // can't be used to multiply the budget.
      return `email:${email.trim().toLowerCase()}`;
    }
    // Fallback: the parent class resolves IP via `req.ips` / `req.ip`.
    return super.getTracker(req);
  }
}
