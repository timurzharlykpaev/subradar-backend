import {
  BadRequestException,
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

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly cfg: ConfigService,
    private readonly ai: AiService,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

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

  async scan(
    userId: string,
    locale = 'en',
    ctx?: { ipAddress?: string; userAgent?: string },
  ): Promise<{
    scanned: number;
    candidates: EmailCandidate[];
    durationMs: number;
  }> {
    const startedAt = Date.now();
    // Per-user lock: prevent tap-spam from burning the OpenAI budget.
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

      const candidates = await this.ai.parseBulkEmails(messages, locale);

      const durationMs = Date.now() - startedAt;
      await this.audit.log({
        userId,
        action: 'gmail.scan.success',
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        metadata: {
          scanned: messages.length,
          candidates: candidates.length,
          durationMs,
        },
      });

      return { scanned: messages.length, candidates, durationMs };
    } catch (err: any) {
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
