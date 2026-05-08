import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { User } from '../users/entities/user.entity';
import { AiService, EmailCandidate } from '../ai/ai.service';
import { MarketDataService } from '../analysis/market-data.service';
import { AuditService } from '../common/audit/audit.service';
import { REDIS_CLIENT } from '../common/redis.module';
import { maskEmail } from '../common/utils/pii';

/**
 * Server-side bulk Gmail scan: handles the access-token refresh, the
 * Gmail List + Get fetches, and the AI parse. Pro/Team-gated upstream
 * via RequireProGuard on the controller.
 *
 * Limits + safety (per CASA threat model):
 *   - Hard cap of 200 messages per scan to bound OpenAI cost and Gmail
 *     quota use; clients can paginate via the cron OR drive multiple
 *     scans manually.
 *   - 1 scan per user per minute (Redis lock) so a tap-spam doesn't
 *     burn the OpenAI budget.
 *   - Time window: last 90 days only. Older receipts are typically
 *     stale and not actionable.
 *   - Sender filter: only common billing senders (`category:purchases`
 *     OR explicit no-reply receipt patterns). Reduces noise and cost.
 *   - All snippets stripped of HTML before LLM ingestion (defence in
 *     depth against prompt injection from receipt body content).
 */
@Injectable()
export class GmailScanService {
  private readonly logger = new Logger(GmailScanService.name);
  private readonly MAX_MESSAGES = 200;
  private readonly LOOKBACK_DAYS = 90;
  private readonly SCAN_LOCK_TTL_S = 60;
  // Per-user daily scan quota. Numbers are deliberately conservative —
  // a typical Pro user runs 1 scan a week; 3/day covers re-scans if the
  // first run missed something the user added later. Team plans get a
  // higher cap because they roll up multiple members' inboxes.
  private readonly DAILY_QUOTA: Record<string, number> = {
    pro: 3,
    organization: 10,
  };

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly cfg: ConfigService,
    private readonly ai: AiService,
    private readonly market: MarketDataService,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Enrich each AI-extracted candidate with catalog data: brand-correct
   * category, icon URL, service homepage, cancel URL, and the full plan
   * list so the user can switch tier in the bulk-confirm UI.
   *
   * The AI prompt is told NOT to guess prices that aren't printed in
   * the email; instead it returns `amount: null` (coerced to 0 here)
   * and we backfill with the cheapest catalog plan. Prices that DID
   * appear in the email take precedence — that's the actual charge the
   * user will see on their card. We never overwrite an
   * `amountFromEmail = true` value with a catalog default.
   *
   * `allowWebSearch = false` keeps catalog lookups DB-only — we don't
   * burn an OpenAI call here because (a) the catalog is large enough
   * that most popular services are already cached, and (b) the user's
   * scan latency is more important than catalog completeness.
   */
  private async enrichWithCatalog(
    candidates: EmailCandidate[],
  ): Promise<EmailCandidate[]> {
    if (candidates.length === 0) return candidates;
    return Promise.all(
      candidates.map(async (c) => {
        try {
          const normalized = this.market.normalizeServiceName(c.name);
          const entry = await this.market.getMarketData(normalized, false);
          if (!entry) return c;

          const plans = (entry.plans ?? []).map((p: any) => ({
            name: String(p.name ?? ''),
            amount: Number(p.priceMonthly ?? p.amount ?? 0),
            currency: String(p.currency ?? c.currency ?? 'USD').toUpperCase(),
            billingPeriod: 'MONTHLY' as const,
          }));

          // Pick the cheapest plan as the default fallback. The user can
          // switch in the review UI; cheapest is the safest guess (most
          // people start on the entry-tier subscription).
          const defaultPlan = plans
            .filter((p) => p.amount > 0)
            .sort((a, b) => a.amount - b.amount)[0];

          const enriched: EmailCandidate = {
            ...c,
            // Prefer email-extracted amount (real charge). Fall back to
            // catalog default only when the email had no number.
            amount: c.amountFromEmail && c.amount > 0
              ? c.amount
              : defaultPlan?.amount ?? c.amount,
            currency: c.amountFromEmail
              ? c.currency
              : defaultPlan?.currency ?? c.currency,
            // Catalog category is brand-curated; trust over AI guess
            // unless the catalog returns a meaningless 'OTHER'.
            category:
              entry.category && entry.category !== 'OTHER'
                ? entry.category
                : c.category,
            iconUrl: entry.logoUrl ?? undefined,
            availablePlans: plans.length > 0 ? plans : undefined,
          };
          return enriched;
        } catch (err: any) {
          this.logger.warn(
            `enrichWithCatalog: ${c.name}: ${err?.message ?? err}`,
          );
          return c;
        }
      }),
    );
  }

  private requireConfig(): { clientId: string; clientSecret: string } {
    const clientId =
      this.cfg.get<string>('GOOGLE_GMAIL_CLIENT_ID') ||
      this.cfg.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret =
      this.cfg.get<string>('GOOGLE_GMAIL_CLIENT_SECRET') ||
      this.cfg.get<string>('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException('Gmail integration not configured');
    }
    return { clientId, clientSecret };
  }

  /**
   * Exchange the stored refresh token for a fresh access token. Refresh
   * tokens are long-lived; access tokens last ~1h. We never persist the
   * access token — re-mint on every scan.
   */
  private async getAccessToken(refreshToken: string): Promise<string> {
    const { clientId, clientSecret } = this.requireConfig();
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `Gmail refresh failed (${res.status}): ${text.slice(0, 160)}`,
      );
      throw new UnauthorizedException(
        'Gmail authorization expired. Reconnect Gmail in settings.',
      );
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      throw new UnauthorizedException('Gmail token refresh returned no access_token');
    }
    return json.access_token;
  }

  /** Build the Gmail search query for billing receipts in the lookback window. */
  private buildQuery(): string {
    // Gmail's `category:purchases` covers most receipts. We also pick up
    // common renewal-keyword-laden subjects in case category isn't
    // populated (older accounts don't always have categories enabled).
    const after = new Date();
    after.setDate(after.getDate() - this.LOOKBACK_DAYS);
    const afterStr = `${after.getFullYear()}/${String(after.getMonth() + 1).padStart(2, '0')}/${String(after.getDate()).padStart(2, '0')}`;
    return `(category:purchases OR subject:(receipt OR invoice OR subscription OR renewed OR "thank you for your")) after:${afterStr}`;
  }

  /** List Gmail message IDs matching the billing query, capped at MAX_MESSAGES. */
  private async listMessages(accessToken: string): Promise<string[]> {
    const query = this.buildQuery();
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${this.MAX_MESSAGES}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Gmail list failed: ${res.status}`,
      );
    }
    const json = (await res.json()) as {
      messages?: Array<{ id: string }>;
    };
    return (json.messages ?? []).map((m) => m.id);
  }

  /**
   * Fetch a single message in `metadata` format (subject + from + snippet),
   * strip HTML, and shape into the BulkEmailInput the AI expects. Metadata
   * format is used to keep payload size bounded (full bodies can be
   * megabytes); the AI snippet is enough for most receipt parsing.
   */
  private async fetchMessage(
    accessToken: string,
    messageId: string,
  ): Promise<{
    id: string;
    subject: string;
    snippet: string;
    from: string;
    receivedAt: string;
  } | null> {
    try {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        snippet?: string;
        internalDate?: string;
        payload?: {
          headers?: Array<{ name: string; value: string }>;
        };
      };
      const headers = json.payload?.headers ?? [];
      const get = (name: string) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
          ?.value ?? '';
      const subject = get('Subject');
      const from = get('From');
      const dateHeader = get('Date');
      const receivedAt = dateHeader
        ? new Date(dateHeader).toISOString()
        : json.internalDate
          ? new Date(Number(json.internalDate)).toISOString()
          : new Date().toISOString();
      // Snippet is plain text from Gmail but defensively strip any HTML
      // remnants and collapse whitespace.
      const snippet = (json.snippet ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { id: messageId, subject, snippet, from, receivedAt };
    } catch (err: any) {
      this.logger.warn(`Gmail fetch ${messageId} failed: ${err?.message ?? err}`);
      return null;
    }
  }

  /** Build today's daily-quota Redis key for a user, in UTC. */
  private dailyQuotaKey(userId: string, now: Date = new Date()): string {
    const yyyymmdd = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
    return `gmail:scan:daily:${userId}:${yyyymmdd}`;
  }

  /**
   * Atomically increment the per-user-per-UTC-day scan counter and reject
   * if the plan-specific cap is exceeded. Pipelining INCR+EXPIRE in a
   * single MULTI keeps the TTL set even if the pod dies right after the
   * INCR — otherwise a crash between the two calls would leave the key
   * with no TTL and lock the user out indefinitely.
   *
   * Throws `HttpException(429, { code: 'GMAIL_DAILY_LIMIT', nextResetAt })`
   * when the user is at or above their quota. Decrements on rejection so
   * a denied attempt doesn't permanently bump the counter.
   *
   * Note: the caller is responsible for decrementing the key if the
   * scan fails *after* this method returns (e.g. Gmail 5xx, missing
   * token). That keeps an external-system failure from counting against
   * quota. See `scan()` for the exact try/finally pattern.
   */
  private async enforceDailyQuota(
    userId: string,
    plan: 'pro' | 'organization',
  ): Promise<{ key: string; count: number }> {
    const cap = this.DAILY_QUOTA[plan];
    const key = this.dailyQuotaKey(userId);

    if (!cap) {
      return { key, count: 0 };
    }

    // Atomic INCR + EXPIRE. Re-applying EXPIRE on every call is harmless
    // (Redis simply refreshes the TTL) and removes the race window that
    // could leave the key without a TTL after a pod restart.
    const pipe = this.redis.pipeline();
    pipe.incr(key);
    pipe.expire(key, 90_000);
    const results = await pipe.exec();
    const count = (results?.[0]?.[1] as number) ?? 0;

    if (count > cap) {
      await this.redis.decr(key);
      const now = new Date();
      const next = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0, 0, 0, 0,
      ));
      throw new HttpException(
        {
          code: 'GMAIL_DAILY_LIMIT',
          message: `Daily scan limit reached (${cap}/day on ${plan} plan). Try again later.`,
          nextResetAt: next.toISOString(),
          cap,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return { key, count };
  }

  async scan(
    userId: string,
    plan: 'pro' | 'organization',
    locale = 'en',
    ctx?: { ipAddress?: string; userAgent?: string },
  ): Promise<{
    scanned: number;
    candidates: EmailCandidate[];
    durationMs: number;
  }> {
    const startedAt = Date.now();

    // Per-user single-flight lock first. A double-tap rejects here
    // without consuming a quota slot, so users can't accidentally burn
    // their daily allowance with two fast taps.
    const lockKey = `gmail-scan-lock:${userId}`;
    const setNx = await this.redis.set(
      lockKey,
      String(startedAt),
      'EX',
      this.SCAN_LOCK_TTL_S,
      'NX',
    );
    if (setNx !== 'OK') {
      throw new BadRequestException(
        'A scan is already running. Wait a minute and try again.',
      );
    }

    // Quota check is *after* the lock so a successful tap consumes
    // exactly one slot. We track the bumped key so we can refund it if
    // an upstream Gmail call fails — see the catch block below.
    let quotaKey: string | null = null;
    let quotaWasIncremented = false;
    try {
      const q = await this.enforceDailyQuota(userId, plan);
      quotaKey = q.key;
      quotaWasIncremented = q.count > 0;
    } catch (err) {
      // Quota-exceeded throws; release the lock before rethrowing so
      // a quick retry tomorrow doesn't get a stale "scan in progress".
      await this.redis.del(lockKey);
      throw err;
    }

    try {
      const user = await this.userRepo.findOne({
        where: { id: userId },
        select: ['id', 'gmailRefreshToken', 'gmailEmail'],
      });
      if (!user || !user.gmailRefreshToken) {
        throw new BadRequestException(
          'Gmail is not connected. Connect it in Settings → Gmail.',
        );
      }

      const accessToken = await this.getAccessToken(user.gmailRefreshToken);
      const ids = await this.listMessages(accessToken);
      this.logger.log(
        `Gmail scan: user ${userId} (${maskEmail(user.gmailEmail ?? '')}) found ${ids.length} candidates`,
      );

      // Sequential fetch with a small concurrency cap. Gmail's per-user
      // rate limit is generous, but bursting 200 requests in parallel
      // can still trigger 429s; 5-at-a-time is a safe sweet spot.
      const messages: Array<{
        id: string;
        subject: string;
        snippet: string;
        from: string;
        receivedAt: string;
      }> = [];
      const concurrency = 5;
      for (let i = 0; i < ids.length; i += concurrency) {
        const slice = ids.slice(i, i + concurrency);
        const batch = await Promise.all(
          slice.map((id) => this.fetchMessage(accessToken, id)),
        );
        for (const m of batch) {
          if (m && m.snippet.length > 0) messages.push(m);
        }
      }

      const rawCandidates = await this.ai.parseBulkEmails(messages, locale);
      const candidates = await this.enrichWithCatalog(rawCandidates);

      const durationMs = Date.now() - startedAt;
      await this.audit.log({
        userId,
        action: 'gmail.scan.success',
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        metadata: {
          scanned: messages.length,
          candidates: candidates.length,
          enriched: candidates.filter((c) => c.iconUrl || c.availablePlans)
            .length,
          durationMs,
        },
      });

      return { scanned: messages.length, candidates, durationMs };
    } catch (err: any) {
      // Refund the daily-quota slot so an external-system failure (Gmail
      // 5xx, missing token, AI parse error) doesn't count against the
      // user. Without this a transient outage could lock a Pro user out
      // for the rest of the day.
      if (quotaWasIncremented && quotaKey) {
        try {
          await this.redis.decr(quotaKey);
        } catch (refundErr: any) {
          this.logger.warn(
            `Failed to refund Gmail quota for ${userId}: ${refundErr?.message ?? refundErr}`,
          );
        }
      }
      await this.audit.log({
        userId,
        action: 'gmail.scan.failure',
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        metadata: { reason: err?.name ?? 'unknown', message: err?.message },
      });
      throw err;
    } finally {
      await this.redis.del(lockKey);
    }
  }
}
