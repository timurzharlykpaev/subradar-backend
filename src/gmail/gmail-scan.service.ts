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
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
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
  // Bumped from 200 → 500: an active Gmail user with 3+ years of
  // billing history easily blows past 200 receipts even within a
  // single year. 500 strikes a balance between recall and OpenAI cost
  // (parseBulkEmails chunks the prompt internally).
  private readonly MAX_MESSAGES = 500;
  // Bumped from 90 → 365 days: yearly subscriptions (Adobe Annual,
  // Netflix Annual, GitHub Pro yearly, domain registrations) only
  // generate ONE receipt per year. With a 90-day window we'd silently
  // miss every annual subscription the user has — which is the most
  // forgotten kind. 365 captures the full cycle.
  private readonly LOOKBACK_DAYS = 365;
  private readonly SCAN_LOCK_TTL_S = 60;
  // Pagination chunk for the Gmail messages.list call. Gmail caps a
  // single response at 500; loop with `pageToken` for the rest.
  private readonly LIST_PAGE_SIZE = 500;
  // Hard ceiling on how long Gmail messages.list pagination is allowed
  // to spin. Without it, a pathological inbox could chain N pages * 15s
  // timeout each (75s+ scan duration) and the user sees an indefinite
  // spinner. 30s budget is generous for the realistic 1–2 page case
  // and bails the rare 5+ page edge case before the user gives up.
  private readonly LIST_PAGINATION_BUDGET_MS = 30_000;
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
    private readonly subscriptions: SubscriptionsService,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Drop candidates that are clearly noise so the user doesn't have to
   * uncheck twenty Amazon-shipping-confirmation rows. Keep the bar low
   * enough that legitimate but slightly-ambiguous receipts (e.g. AI's
   * confidence was 0.45 but the brand IS in our catalog) still surface.
   *
   * Filters:
   *   - cancellations: handled separately by the unsubscribe-flow, not
   *     by the import-into-tracker flow.
   *   - non-recurring with no catalog match: AI guessed wrong about
   *     the email being a subscription, and the brand isn't even
   *     known — almost certainly a one-off (Amazon order, ticket
   *     purchase, etc.).
   *   - confidence < 0.3 with no enrichment AND no email-extracted
   *     price: nothing independent to corroborate; drop. If we got a
   *     real charge ($X.XX printed in the email body), that's a
   *     stronger signal than AI's self-reported confidence — keep.
   */
  // Anything beyond this lookback has effectively turned into "old
  // mail" from a subscription POV: a non-yearly receipt that's been
  // silent for 6 months almost certainly means the user already
  // cancelled — importing it as ACTIVE would create dashboard
  // pollution the user has to manually delete. Yearly subscriptions
  // legitimately go this long between receipts, so we exempt them.
  private static readonly STALE_NONYEARLY_MS = 180 * 24 * 60 * 60 * 1000;

  private filterNoise(
    candidates: EmailCandidate[],
    receivedAtById: Map<string, string>,
  ): EmailCandidate[] {
    const now = Date.now();
    return candidates.filter((c) => {
      if (c.isCancellation) return false;
      const enriched = !!c.iconUrl || (c.availablePlans?.length ?? 0) > 0;

      // Stale-receipt filter — a non-YEARLY candidate whose freshest
      // contributing receipt is >180d old is almost certainly a
      // subscription the user has already dropped. We look across
      // `aggregatedFrom` so a service with three receipts (two old,
      // one recent) survives — only fully-cold services get culled.
      if (c.billingPeriod !== 'YEARLY' && !c.isTrial) {
        const sources = c.aggregatedFrom?.length
          ? c.aggregatedFrom
          : [c.sourceMessageId];
        let latest = 0;
        for (const id of sources) {
          const iso = receivedAtById.get(id);
          if (!iso) continue;
          const t = Date.parse(iso);
          if (Number.isFinite(t) && t > latest) latest = t;
        }
        if (latest > 0 && now - latest > GmailScanService.STALE_NONYEARLY_MS) {
          return false;
        }
      }

      // amountFromEmail is the strongest "this is a real subscription"
      // signal we have — a printed money figure on a sender's domain.
      // Keep the row even if AI couldn't confirm "recurring" and the
      // brand isn't in our catalog: the user can decide on the review
      // sheet, and the recall miss (eg. a small SaaS the AI was unsure
      // about) was the main complaint from real scans.
      if (c.amountFromEmail) return true;
      if (!c.isRecurring && !enriched) return false;
      // Lowered 0.3 → 0.2: 0.3 was rejecting borderline-correct
      // candidates from small SaaS senders the AI hadn't seen before;
      // 0.2 still strips obvious junk (unsubscribe-confirmation,
      // shipping-update mails returning ≤0.1) without nuking the
      // long-tail of real subscriptions.
      if (c.confidence < 0.2 && !enriched) return false;
      return true;
    });
  }

  /**
   * Drop candidates that match a subscription the user already has in
   * SubRadar — they presumably added that one previously (manually,
   * via voice, via screenshot, or in a prior scan) and re-importing
   * would create a duplicate row in their dashboard.
   *
   * Match key uses `MarketDataService.normalizeServiceName` on BOTH
   * sides so "Netflix" in the user's existing subs cancels out a
   * fresh "Netflix Premium" candidate from the scan (same brand,
   * different tier wording — without normalisation we'd present the
   * user a duplicate to uncheck every scan).
   *
   * We exclude existing CANCELLED rows so a re-subscription after a
   * past cancellation surfaces correctly. Likewise we skip subs with
   * missing currency/period rather than collapsing them into an empty
   * key (which would over-dedupe other candidates that happen to have
   * empty strings on the candidate side).
   *
   * Read failure is non-fatal: the user gets the full candidate list
   * and can uncheck duplicates manually.
   */
  private async filterDuplicates(
    userId: string,
    candidates: EmailCandidate[],
  ): Promise<EmailCandidate[]> {
    if (candidates.length === 0) return candidates;
    const existing = await this.subscriptions
      .findAllForUser(userId)
      .catch((err) => {
        this.logger.warn(
          `filterDuplicates: subscriptions read failed: ${err?.message ?? err}`,
        );
        return [] as Array<{
          name: string;
          currency: string;
          billingPeriod: string;
          status?: string;
        }>;
      });
    const seen = new Set<string>();
    for (const sub of existing) {
      // Don't dedupe against cancelled subscriptions — user re-
      // subscribing after a cancel is exactly the case scan should
      // catch. Same for missing currency/period (legacy rows from
      // before those fields became required).
      if (sub.status === 'CANCELLED') continue;
      if (!sub.currency || !sub.billingPeriod) continue;
      const normalized = this.market.normalizeServiceName(sub.name ?? '');
      if (!normalized) continue;
      const key = `${normalized}|${sub.currency.toUpperCase()}|${sub.billingPeriod.toUpperCase()}`;
      seen.add(key);
    }
    return candidates.filter((c) => {
      const normalized = this.market.normalizeServiceName(c.name);
      const key = `${normalized}|${c.currency.toUpperCase()}|${c.billingPeriod.toUpperCase()}`;
      return !seen.has(key);
    });
  }

  /**
   * Allowlist of hosts we trust to serve subscription-management URLs.
   * The catalog table is fed partly by AI web-search results, so a
   * compromised LLM (or, more realistically, a hallucinated cancel-URL)
   * could otherwise deep-link a Pro user to an attacker's site under
   * the guise of "manage subscription". We restrict cancelUrl + the
   * user-facing serviceUrl to known account-management domains.
   *
   * Entries are matched on host suffix (`endsWith`) so `*.apple.com`,
   * `*.play.google.com` etc. pass; sub-paths are not constrained
   * because each provider has a different URL structure.
   */
  private static readonly TRUSTED_CANCEL_HOSTS = [
    'apple.com',
    'play.google.com',
    'paypal.com',
    'amazon.com',
    'github.com',
    'stripe.com',
    'paddle.com',
    'paddle.net',
    'lemonsqueezy.com',
    'netflix.com',
    'spotify.com',
    'youtube.com',
    'google.com',
    'microsoft.com',
    'adobe.com',
    'openai.com',
    'anthropic.com',
    'notion.so',
    'dropbox.com',
    'figma.com',
    'slack.com',
    'discord.com',
    'twitch.tv',
    'hbomax.com',
    'disneyplus.com',
    'hulu.com',
    'apple-services.com',
    'subscribestar.com',
    'patreon.com',
  ];

  /**
   * Returns the URL unchanged if its host suffix matches the trusted
   * allowlist, otherwise undefined. Used to scrub `cancelUrl` /
   * `serviceUrl` before persisting them on a candidate — a malformed
   * or attacker-shaped URL never leaves this method.
   */
  private safeCancelUrl(url: string | null | undefined): string | undefined {
    if (!url || typeof url !== 'string') return undefined;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return undefined;
      }
      const host = parsed.hostname.toLowerCase();
      for (const trusted of GmailScanService.TRUSTED_CANCEL_HOSTS) {
        if (host === trusted || host.endsWith(`.${trusted}`)) return url;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /** Cap on OpenAI web-search calls per single scan. Catalog hits are
   * cached forever in `service_catalog`, so subsequent users for the
   * same brand pay zero — but a *first* scan over a pathological inbox
   * with 200 unknown brands could otherwise fan out hundreds of
   * parallel `gpt-4o-mini` calls and burn the OpenAI budget.
   *
   * Tunable via env `GMAIL_MAX_WEB_SEARCHES_PER_SCAN` so we can dial
   * up/down under cost-pressure or when bulk-loading the catalog from
   * known-good brands. Default 20 fits the realistic case (≤20 unique
   * unknown brands per scan).
   */
  private get MAX_WEB_SEARCHES_PER_SCAN(): number {
    const raw = this.cfg.get<string>('GMAIL_MAX_WEB_SEARCHES_PER_SCAN');
    if (raw == null || raw === '') return 20;
    const parsed = Number(raw);
    // Guard against typo'd or zero values silently disabling the
    // catalog enrichment step. A literal "0" override is rejected
    // here too — disabling the feature accidentally is more harmful
    // than the cost of running it.
    if (!Number.isFinite(parsed) || parsed < 1) {
      this.logger.warn(
        `[gmail.scan] invalid GMAIL_MAX_WEB_SEARCHES_PER_SCAN="${raw}", falling back to 20`,
      );
      return 20;
    }
    return parsed;
  }

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
   * Lookup uses `MarketDataService.batchLookup`, which sequences calls
   * and caps OpenAI web searches at MAX_WEB_SEARCHES_PER_SCAN. Without
   * this cap, a 500-message inbox with many unknown brands would
   * Promise.all into hundreds of parallel OpenAI calls (cost runaway).
   * Web-searched results persist to the catalog table, so the next
   * user scanning the same brand pays $0.
   */
  private async enrichWithCatalog(
    candidates: EmailCandidate[],
  ): Promise<EmailCandidate[]> {
    if (candidates.length === 0) return candidates;

    // Build the unique set of normalised names that are *eligible* for
    // web-search (recurring, non-cancellation). One-off "thanks for
    // your order" rows still get a catalog hit if the brand is
    // already cached, but never trigger a fresh web search.
    const namesToLookup = new Set<string>();
    for (const c of candidates) {
      if (c.isRecurring && !c.isCancellation) {
        namesToLookup.add(this.market.normalizeServiceName(c.name));
      }
    }
    const catalogByName = await this.market.batchLookup(
      Array.from(namesToLookup),
      this.MAX_WEB_SEARCHES_PER_SCAN,
    );

    return candidates.map((c) => {
      try {
        const normalized = this.market.normalizeServiceName(c.name);
        const entry = catalogByName.get(normalized);
        if (!entry) return c;

        // Catalog stores plan price as `priceMonthly` only — no
        // weekly/quarterly tiers, no annual-discount figure. So we
        // backfill conservatively:
        //   - candidate.billingPeriod === MONTHLY → use monthly price
        //   - YEARLY → 12× monthly (upper bound; real annual usually
        //     ~15–20% cheaper). Set `amountIsApproximate = true` so
        //     UI marks it for review.
        //   - WEEKLY / QUARTERLY / LIFETIME / ONE_TIME → leave the
        //     amount the AI extracted (or 0). Multiplying a monthly
        //     figure by 0.231 / 3 / 1 fabricates a number that doesn't
        //     correspond to any real plan the service actually sells,
        //     which is worse UX than an empty field the user fills.
        const plans = (entry.plans ?? []).map((p: any) => ({
          name: String(p.name ?? ''),
          amount: Number(p.priceMonthly ?? p.amount ?? 0),
          currency: String(p.currency ?? c.currency ?? 'USD').toUpperCase(),
          billingPeriod: 'MONTHLY' as const,
        }));

        const defaultPlan = plans
          .filter((p) => p.amount > 0)
          .sort((a, b) => a.amount - b.amount)[0];

        let fallbackAmount = c.amount;
        let amountIsApproximate = false;
        if (!c.amountFromEmail && defaultPlan) {
          if (c.billingPeriod === 'MONTHLY') {
            fallbackAmount = defaultPlan.amount;
          } else if (c.billingPeriod === 'YEARLY') {
            fallbackAmount = Number((defaultPlan.amount * 12).toFixed(2));
            amountIsApproximate = true;
          }
          // For WEEKLY / QUARTERLY / LIFETIME / ONE_TIME we leave
          // c.amount alone (most often 0) — the UI will show "—" and
          // the user enters the real figure.
        }

        // Cancel/service URLs go through an allowlist so a hallucinated
        // or compromised catalog entry can't deep-link the user to an
        // attacker domain under the guise of "Manage Subscription".
        // Currently the catalog schema doesn't store cancelUrl/serviceUrl
        // (see ServiceCatalog entity); this scrubs the AI-returned values
        // and is the chokepoint for the day either field gets sourced
        // from a less-trusted location (web-search, user-edits, etc).
        const safeServiceUrl = this.safeCancelUrl(
          (entry as any).serviceUrl ?? c.serviceUrl,
        );
        const safeCancelUrl = this.safeCancelUrl(
          (entry as any).cancelUrl ?? c.cancelUrl,
        );

        const enriched: EmailCandidate = {
          ...c,
          amount: c.amountFromEmail && c.amount > 0
            ? c.amount
            : fallbackAmount,
          currency: c.amountFromEmail
            ? c.currency
            : defaultPlan?.currency ?? c.currency,
          category:
            entry.category && entry.category !== 'OTHER'
              ? entry.category
              : c.category,
          iconUrl: entry.logoUrl ?? undefined,
          serviceUrl: safeServiceUrl,
          cancelUrl: safeCancelUrl,
          availablePlans: plans.length > 0 ? plans : undefined,
          amountIsApproximate: amountIsApproximate || undefined,
        };
        return enriched;
      } catch (err: any) {
        this.logger.warn(
          `enrichWithCatalog: ${c.name}: ${err?.message ?? err}`,
        );
        return c;
      }
    });
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
   *
   * When Google rejects the refresh token (revoked grant, password
   * change, 6-month inactivity expiry — all return 4xx here), we clear
   * the user's stored Gmail credentials before throwing. Without this
   * step the next `/gmail/status` call still reports `connected: true`
   * because the dead token is in our DB, the user retries scan, and
   * gets the same 401 again — a loop the user can only break by
   * manually tapping "Disconnect" then "Connect". Auto-clearing flips
   * the next status read to `connected: false` so the UI naturally
   * surfaces the "Connect Gmail" CTA again.
   *
   * We only clear on explicit 4xx ("invalid_grant", "invalid_client",
   * etc.). 5xx and timeouts keep the token because they're transient —
   * a Google outage shouldn't force every user to reconnect.
   */
  private async getAccessToken(
    userId: string,
    refreshToken: string,
  ): Promise<string> {
    const { clientId, clientSecret } = this.requireConfig();
    let res: Response;
    try {
      res = await fetch('https://oauth2.googleapis.com/token', {
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
    } catch (err: any) {
      // Network / timeout — token may still be valid, surface as a
      // retryable error without auto-clearing.
      this.logger.warn(`Gmail refresh network error: ${err?.message ?? err}`);
      throw new InternalServerErrorException(
        'Gmail authorization could not be refreshed (network). Please try again.',
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `Gmail refresh failed (${res.status}): ${text.slice(0, 160)}`,
      );
      // 4xx from Google's token endpoint is terminal for this refresh
      // token: it won't start working again on its own. Clear our
      // stored copy so the user is treated as disconnected from the
      // next request onwards. 5xx is transient — leave it alone.
      if (res.status >= 400 && res.status < 500) {
        await this.clearGmailCredentials(userId, `refresh_${res.status}`);
      }
      throw new UnauthorizedException(
        'Gmail authorization expired. Reconnect Gmail in settings.',
      );
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      // Same shape as a 4xx — Google accepted the request but won't
      // hand out an access token. Treat as a dead grant.
      await this.clearGmailCredentials(userId, 'no_access_token');
      throw new UnauthorizedException(
        'Gmail token refresh returned no access_token',
      );
    }
    return json.access_token;
  }

  /**
   * Null out a user's Gmail credentials and audit it. Used by the
   * refresh-failure path so a dead grant doesn't keep reporting
   * `connected: true` to the mobile client. Failures here are logged
   * but never propagated — the upstream caller still throws the
   * UnauthorizedException either way, and a DB hiccup shouldn't
   * upgrade a 401 into a 500.
   */
  private async clearGmailCredentials(
    userId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.userRepo.update(
        { id: userId },
        {
          gmailRefreshToken: null as any,
          gmailConnectedAt: null,
          gmailEmail: null as any,
          gmailScopes: null as any,
        },
      );
      // Drop any cached scan result so a reconnect doesn't surface
       // last-session candidates as if they were fresh.
      try {
        await this.redis.del(this.resultCacheKey(userId));
      } catch {
        /* cache eviction is best-effort */
      }
      await this.audit.log({
        userId,
        action: 'gmail.auto_disconnect',
        metadata: { reason },
      });
      this.logger.log(
        `[gmail.auto_disconnect] cleared credentials for ${userId.slice(0, 8)} (${reason})`,
      );
    } catch (err: any) {
      this.logger.warn(
        `[gmail.auto_disconnect] failed to clear credentials for ${userId}: ${err?.message ?? err}`,
      );
    }
  }

  /**
   * Build the Gmail search query for billing receipts in the lookback
   * window. The query is intentionally broad so we don't miss receipts
   * just because Gmail Tabs are disabled or the receipt is in a
   * non-English locale:
   *
   * - `category:purchases` is preferred when available (Tabs on)
   * - Subject keyword list is multilingual: EN + RU + ES + DE + FR
   *   covers the bulk of common SaaS/streaming receipt subjects we've
   *   seen in real inboxes.
   * - Sender-based heuristics catch billing addresses ("no-reply",
   *   "billing", "invoice", "receipts") which fire for services that
   *   don't put a money keyword in the subject (Spotify, Apple TV+,
   *   bank-issued receipts, etc.).
   *
   * The downside of a broad query is more messages → more tokens to
   * the AI parser. The OR'd structure keeps Gmail's index efficient,
   * and the AI step deduplicates aggressively.
   */
  private buildQuery(): string {
    const after = new Date();
    after.setDate(after.getDate() - this.LOOKBACK_DAYS);
    const afterStr = `${after.getFullYear()}/${String(after.getMonth() + 1).padStart(2, '0')}/${String(after.getDate()).padStart(2, '0')}`;
    const subjectKeywords = [
      // English
      'receipt',
      'invoice',
      'subscription',
      'subscribed',
      'renewed',
      'renewal',
      'charged',
      'payment',
      '"thank you for your"',
      'membership',
      // Russian
      'чек',
      'счёт',
      'счет',
      'подписка',
      'продление',
      'оплата',
      'квитанция',
      // Spanish
      'recibo',
      'factura',
      'suscripción',
      'suscripcion',
      'pago',
      // German
      'rechnung',
      'beleg',
      'abonnement',
      'zahlung',
      // French
      'reçu',
      'facture',
      'abonnement',
      'paiement',
    ].join(' OR ');
    // Generic billing-shaped local-parts ("billing@…", "invoice@…")
    // plus a few payment-processor domains that route receipts under
    // their own brand (Stripe, Paddle, Lemon Squeezy, Apple, Google
    // Play, GitHub). Without these the previous query missed every
    // Stripe-issued receipt from a small-SaaS subscription because the
    // From address is `support@stripe.com` — which doesn't match any
    // of the generic hints. Pure additive — these all OR with the
    // existing pattern so we never *exclude* a mail that matched
    // before.
    const senderHints = [
      'no-reply',
      'noreply',
      'billing',
      'invoice',
      'receipts',
      'receipt',
      'support',
      'notifications',
      'payments',
      'team',
      // Payment processors / app-stores that re-issue subscription
      // receipts under their own brand. Catches Apple / Google Play
      // family-share charges that don't carry the merchant's name in
      // the From header.
      'stripe.com',
      'paddle.com',
      'paddle.net',
      'lemonsqueezy.com',
      'apple.com',
      'itunes.com',
      'google.com',
      'googleplay',
      'github.com',
      'paypal.com',
    ].join(' OR ');
    return `(category:purchases OR subject:(${subjectKeywords}) OR from:(${senderHints})) after:${afterStr}`;
  }

  /**
   * List Gmail message IDs matching the billing query, paginated up to
   * MAX_MESSAGES. Single Gmail API page maxes out at 500 messages; we
   * loop with `pageToken` so accounts with thousands of receipts still
   * get full coverage rather than a 200-message slice off the top.
   */
  /**
   * Returns the message ids plus a `truncated` flag indicating whether
   * the inbox had MORE matches than we returned. The flag is true when
   * we hit MAX_MESSAGES OR the pagination budget while Gmail still
   * had a `nextPageToken` queued. Mobile uses this to render a
   * "we couldn't read your whole inbox in one go" banner so the user
   * doesn't think the scan is complete when it actually was capped.
   */
  private async listMessages(
    accessToken: string,
  ): Promise<{ ids: string[]; truncated: boolean }> {
    const query = this.buildQuery();
    const ids: string[] = [];
    const paginationStart = Date.now();
    let pageToken: string | undefined;
    let pages = 0;
    let truncated = false;
    while (ids.length < this.MAX_MESSAGES) {
      const elapsed = Date.now() - paginationStart;
      if (elapsed > this.LIST_PAGINATION_BUDGET_MS) {
        // Budget exhausted; surface what we have rather than chain
        // another 15s page fetch. Logged so we can spot inboxes that
        // consistently trip the cap and tune accordingly.
        this.logger.warn(
          `[gmail.scan][stage:list] budget exceeded after ${pages} pages, ${ids.length} ids`,
        );
        truncated = pageToken != null;
        break;
      }
      const remaining = this.MAX_MESSAGES - ids.length;
      const pageSize = Math.min(this.LIST_PAGE_SIZE, remaining);
      const params = new URLSearchParams({
        maxResults: String(pageSize),
        q: query,
      });
      if (pageToken) params.set('pageToken', pageToken);
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new InternalServerErrorException(
          `Gmail list failed: ${res.status}`,
        );
      }
      const json = (await res.json()) as {
        messages?: Array<{ id: string }>;
        nextPageToken?: string;
      };
      const page = (json.messages ?? []).map((m) => m.id);
      ids.push(...page);
      pages++;
      if (!json.nextPageToken || page.length === 0) break;
      pageToken = json.nextPageToken;
    }
    // Hit the message cap before exhausting Gmail's pageToken queue =
    // truncated too.
    if (ids.length >= this.MAX_MESSAGES && pageToken) truncated = true;
    return { ids: ids.slice(0, this.MAX_MESSAGES), truncated };
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

  // Result cache window. A returning user who comes back within this
  // window (e.g. pulled the app from background after a 30-second scan)
  // sees the same review sheet instead of being forced to scan again
  // and burn another daily-quota slot. Bypassed via `force: true`.
  private static readonly RESULT_CACHE_TTL_S = 600;

  // Bump this when the shape of the cached object changes
  // (EmailCandidate fields added/renamed, new required keys, etc) so
  // a deploy doesn't serve old-shape blobs to new-shape clients for
  // up to RESULT_CACHE_TTL_S. v1 is the initial cached-result version.
  private static readonly RESULT_CACHE_VERSION = 'v1';

  private resultCacheKey(userId: string): string {
    return `gmail:scan:result:${GmailScanService.RESULT_CACHE_VERSION}:${userId}`;
  }

  async scan(
    userId: string,
    plan: 'pro' | 'organization',
    locale = 'en',
    ctx?: { ipAddress?: string; userAgent?: string; force?: boolean },
  ): Promise<{
    scanned: number;
    candidates: EmailCandidate[];
    durationMs: number;
    /** True when Gmail returned more matching messages than we read.
     * Mobile renders a banner inviting the user to re-scan. Old
     * clients (≤1.3.21) ignore unknown fields → no compat break. */
    truncated: boolean;
    /** True when this response was served from a cached prior scan
     * (within RESULT_CACHE_TTL_S). Mobile uses this to swap the loader
     * for the review sheet without a fake delay, and to expose a
     * "Scan again" CTA. Old clients ignore the field. */
    cached?: boolean;
    /** Funnel breakdown so mobile can render a meaningful empty
     * state (e.g. "1 already in your list" vs "no receipts found"
     * vs "AI found nothing"). Without this `candidates: []` looks
     * identical regardless of whether the inbox was empty, the AI
     * parsed nothing, or every find was a duplicate of an existing
     * subscription. Old clients ignore unknown fields. */
    summary: {
      aiReturned: number;
      droppedNoise: number;
      droppedDup: number;
    };
  }> {
    const startedAt = Date.now();

    // Short-circuit on cached prior scan unless the caller forces a
    // refresh. Done BEFORE acquiring the single-flight lock so the
    // common "user briefly backgrounded the app and came back" path
    // doesn't fight the lock with the in-flight scan they kicked off.
    if (!ctx?.force) {
      try {
        const cached = await this.redis.get(this.resultCacheKey(userId));
        if (cached) {
          const parsed = JSON.parse(cached) as {
            scanned: number;
            candidates: EmailCandidate[];
            durationMs: number;
            truncated: boolean;
            summary: { aiReturned: number; droppedNoise: number; droppedDup: number };
          };
          this.logger.log(
            `[gmail.scan][user:${userId.slice(0, 8)}] returning cached result (${parsed.candidates.length} candidates)`,
          );
          return { ...parsed, cached: true };
        }
      } catch (err: any) {
        // A cache read miss / parse error is non-fatal — fall through
        // to a real scan.
        this.logger.warn(
          `[gmail.scan] cache read failed for ${userId}: ${err?.message ?? err}`,
        );
      }
    }

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

      // Stage tags in log lines make it trivial to grep prod logs and
      // see which step a slow / failing scan got stuck on. Without
      // them, "Gmail scan failed" gives no signal between Gmail API
      // 5xx, Gmail token expired, OpenAI timeout, or catalog DB error.
      const userTag = `[gmail.scan][user:${userId.slice(0, 8)}]`;
      this.logger.log(`${userTag}[stage:list] starting…`);

      const accessToken = await this.getAccessToken(
        userId,
        user.gmailRefreshToken,
      );
      const { ids, truncated } = await this.listMessages(accessToken);
      this.logger.log(
        `${userTag}[stage:list] done — ${ids.length} ids${truncated ? ' (TRUNCATED)' : ''} (${maskEmail(user.gmailEmail ?? '')})`,
      );

      // Concurrent fetch. Gmail per-user budget is 250 quota units/s and
      // a metadata GET costs 5 units → 50 GETs/s is the theoretical
      // ceiling. 10-at-a-time stays comfortably under that while halving
      // the wall-clock fetch stage on a 200-message scan compared with
      // the previous 5. Bursting past 10 starts to risk per-second 429s,
      // and the AI parse stage downstream is still the long pole anyway.
      this.logger.log(`${userTag}[stage:fetch] starting (${ids.length} msgs)…`);
      const messages: Array<{
        id: string;
        subject: string;
        snippet: string;
        from: string;
        receivedAt: string;
      }> = [];
      const concurrency = 10;
      for (let i = 0; i < ids.length; i += concurrency) {
        const slice = ids.slice(i, i + concurrency);
        const batch = await Promise.all(
          slice.map((id) => this.fetchMessage(accessToken, id)),
        );
        for (const m of batch) {
          if (m && m.snippet.length > 0) messages.push(m);
        }
      }
      this.logger.log(
        `${userTag}[stage:fetch] done — ${messages.length} non-empty`,
      );

      this.logger.log(`${userTag}[stage:ai-parse] starting…`);
      const rawCandidates = await this.ai.parseBulkEmails(messages, locale);
      this.logger.log(
        `${userTag}[stage:ai-parse] done — ${rawCandidates.length} candidates`,
      );

      this.logger.log(`${userTag}[stage:enrich] starting…`);
      const enriched = await this.enrichWithCatalog(rawCandidates);
      this.logger.log(
        `${userTag}[stage:enrich] done — ${enriched.filter((c) => c.iconUrl).length} enriched`,
      );

      // Index receivedAt by message id so the stale-filter can find each
      // candidate's freshest contributing receipt without a second
      // Gmail round-trip.
      const receivedAtById = new Map<string, string>();
      for (const m of messages) receivedAtById.set(m.id, m.receivedAt);
      const denoised = this.filterNoise(enriched, receivedAtById);
      const candidates = await this.filterDuplicates(userId, denoised);
      this.logger.log(
        `${userTag}[stage:filter] noise=${enriched.length - denoised.length} dup=${denoised.length - candidates.length} → ${candidates.length} returned`,
      );

      // Refund the daily-quota slot if dedup hid every candidate as
      // already-imported. Re-running scan to discover *new* receipts is
      // the intended UX — a "nothing new since last scan" outcome
      // shouldn't burn one of the 3-per-day Pro slots. We only refund
      // when there were enriched candidates that got fully filtered by
      // dedup; if the inbox was just empty (no receipts), we keep the
      // quota consumed (the Gmail API + AI work was real).
      if (
        quotaWasIncremented &&
        quotaKey &&
        candidates.length === 0 &&
        denoised.length > 0
      ) {
        try {
          await this.redis.decr(quotaKey);
          quotaWasIncremented = false;
        } catch (refundErr: any) {
          this.logger.warn(
            `Failed to refund Gmail quota (no new) for ${userId}: ${refundErr?.message ?? refundErr}`,
          );
        }
      }

      const durationMs = Date.now() - startedAt;
      await this.audit.log({
        userId,
        action: 'gmail.scan.success',
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        metadata: {
          scanned: messages.length,
          candidates: candidates.length,
          // Funnel metrics are gold for tuning thresholds: AI parse →
          // catalog enrichment → noise filter → dedup against existing
          // subscriptions. If `dropped_dup` blows up we know we should
          // surface "already tracked" hints instead of silently
          // hiding rows.
          ai_returned: rawCandidates.length,
          dropped_noise: enriched.length - denoised.length,
          dropped_dup: denoised.length - candidates.length,
          enriched_count: enriched.filter((c) => c.iconUrl || c.availablePlans)
            .length,
          durationMs,
        },
      });

      const result = {
        scanned: messages.length,
        candidates,
        durationMs,
        truncated,
        summary: {
          aiReturned: rawCandidates.length,
          droppedNoise: enriched.length - denoised.length,
          droppedDup: denoised.length - candidates.length,
        },
      };

      // Cache for the briefly-backgrounded-app case. Failures here
      // never block the scan return — the user gets results either way.
      try {
        await this.redis.set(
          this.resultCacheKey(userId),
          JSON.stringify(result),
          'EX',
          GmailScanService.RESULT_CACHE_TTL_S,
        );
      } catch (cacheErr: any) {
        this.logger.warn(
          `[gmail.scan] cache write failed for ${userId}: ${cacheErr?.message ?? cacheErr}`,
        );
      }

      return result;
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
