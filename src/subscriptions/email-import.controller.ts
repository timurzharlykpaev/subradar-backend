import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  PayloadTooLargeException,
  Post,
  Req,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireProGuard } from '../auth/guards/require-pro.guard';
import { AiService } from '../ai/ai.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionStatus } from './entities/subscription.entity';
import { KnownBillingSender } from './email-import/known-billing-sender.entity';
import { ParseBulkDto } from './email-import/dto/parse-bulk.dto';

interface InboundEmail {
  From: string;
  To: string;
  Subject: string;
  TextBody?: string;
  HtmlBody?: string;
}

@ApiTags('email-import')
@Controller('email-import')
export class EmailImportController {
  private readonly logger = new Logger(EmailImportController.name);

  constructor(
    private readonly subsService: SubscriptionsService,
    private readonly aiService: AiService,
    private readonly usersService: UsersService,
    @InjectRepository(KnownBillingSender)
    private readonly senders: Repository<KnownBillingSender>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // ── Existing forwarding flow (unchanged for backward compat) ──────────────

  /**
   * Receives forwarded emails and parses subscription data from them.
   * User forwards any receipt/subscription email to import@subradar.ai
   * Postmark/Resend routes it here as a webhook.
   */
  @Post('inbound')
  @HttpCode(200)
  @ApiOperation({ summary: 'Process inbound forwarded email for subscription import' })
  async handleInbound(@Body() payload: InboundEmail, @Headers('x-import-token') token: string) {
    const expectedToken = process.env.EMAIL_IMPORT_TOKEN;
    if (!expectedToken || token !== expectedToken) {
      this.logger.warn('Email import: invalid or missing x-import-token');
      return { ok: false, reason: 'invalid_token' };
    }

    const to = payload.To ?? '';
    const match = to.match(/import\+([a-zA-Z0-9-]+)@/);
    if (!match) {
      this.logger.warn(`Email import: no userId in To: ${to}`);
      return { ok: false, reason: 'no_user_id' };
    }

    const userId = match[1];
    const user = await this.usersService.findById(userId).catch(() => null);
    if (!user) {
      this.logger.warn(`Email import: user not found ${userId}`);
      return { ok: false, reason: 'user_not_found' };
    }

    const text = payload.TextBody ?? payload.HtmlBody?.replace(/<[^>]+>/g, ' ') ?? '';
    const subject = payload.Subject ?? '';
    const combined = `Subject: ${subject}\n\n${text}`.slice(0, 3000);

    const keywords = ['subscription', 'billing', 'receipt', 'invoice', 'renewal', 'charged', 'payment', 'plan', 'monthly', 'annual', 'trial'];
    const lower = combined.toLowerCase();
    const isRelevant = keywords.some((k) => lower.includes(k));

    if (!isRelevant) {
      this.logger.log(`Email import: not a subscription email (${subject}) for user ${userId}`);
      return { ok: false, reason: 'not_subscription_email' };
    }

    let parsed: any;
    try {
      const result = await this.aiService.parseBulkSubscriptions(combined, 'en');
      parsed = Array.isArray(result) ? result[0] : result;
    } catch (e) {
      this.logger.error(`Email import AI parse failed: ${e}`);
      return { ok: false, reason: 'ai_parse_failed' };
    }

    if (!parsed?.name || !parsed?.amount) {
      this.logger.log(`Email import: AI couldn't extract subscription from "${subject}"`);
      return { ok: false, reason: 'not_enough_data' };
    }

    const existing = await this.subsService.findAll(userId);
    const isDuplicate = existing.some(
      (s) => s.name.toLowerCase() === (parsed.name as string).toLowerCase(),
    );

    if (isDuplicate) {
      this.logger.log(`Email import: duplicate subscription "${parsed.name}" for user ${userId}`);
      return { ok: true, reason: 'duplicate', name: parsed.name };
    }

    const sub = await this.subsService.create(userId, {
      name: parsed.name,
      amount: parsed.amount,
      currency: parsed.currency ?? 'USD',
      billingPeriod: parsed.billingPeriod ?? 'MONTHLY',
      category: parsed.category ?? 'OTHER',
      status: SubscriptionStatus.ACTIVE,
      notes: `Imported from email: ${subject}`,
    });

    this.logger.log(`Email import: created subscription "${sub.name}" ($${sub.amount}) for user ${userId}`);
    return { ok: true, imported: true, name: sub.name, amount: sub.amount };
  }

  /**
   * Returns the unique import email address for the current user.
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('address')
  @HttpCode(200)
  getImportAddress(@Request() req) {
    return {
      email: `import+${req.user.id}@subradar.ai`,
      instructions: 'Forward any subscription receipt to this address and we\'ll import it automatically.',
    };
  }

  // ── Gmail scan flow (NEW, R1, Pro/Team only) ──────────────────────────────

  /**
   * Curated allowlist of billing senders. Mobile uses this to build a Gmail
   * search query (`from:(...)`). Updated server-side without a mobile release.
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RequireProGuard)
  @Get('known-senders')
  @HttpCode(200)
  async getKnownSenders() {
    const rows = await this.senders.find({ where: { active: true } });
    return {
      senders: rows.map((r) => ({
        domain: r.domain,
        emailPattern: r.emailPattern,
        serviceName: r.serviceName,
        category: r.category,
        defaultCurrency: r.defaultCurrency,
      })),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Parse a bulk of email snippets fetched client-side from Gmail.
   *
   * Privacy contract:
   *  - Caller (mobile) reads emails directly from Gmail with the user's
   *    OAuth token. We never see refresh tokens.
   *  - Snippets sit in this request-scope only. They are NOT logged
   *    (verified by /email-import audit), NOT stored, NOT forwarded
   *    anywhere except the OpenAI `chat.completions` call.
   *  - Response contains structured candidates only — no raw text.
   *
   * Limits:
   *  - 1 request / 60s / user (per-user throttle, prevents abuse)
   *  - max 800 messages per request (DTO-level, returns 413)
   *  - Pro/Team only (RequireProGuard, returns 402 for Free)
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RequireProGuard)
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  @Post('parse-bulk')
  @HttpCode(200)
  async parseBulk(@Body() dto: ParseBulkDto, @Req() req) {
    const userId = req.user.id;

    if (dto.messages.length > 800) {
      throw new PayloadTooLargeException('Max 800 messages per request');
    }

    const candidates = await this.aiService.parseBulkEmails(dto.messages, dto.locale);

    // Mark scan timestamp atomically; first connection sets gmail_connected_at.
    await this.dataSource
      .createQueryBuilder()
      .update(User)
      .set({
        gmailLastScanAt: () => 'NOW()',
        gmailConnectedAt: () => 'COALESCE(gmail_connected_at, NOW())',
      })
      .where('id = :id', { id: userId })
      .execute();

    // Filter on backend as defense in depth — mobile already filters too.
    const recurring = candidates.filter((c) => c.isRecurring && !c.isCancellation);

    return {
      candidates: recurring,
      scannedCount: dto.messages.length,
      droppedCount: dto.messages.length - recurring.length,
    };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('status')
  @HttpCode(200)
  async getStatus(@Req() req) {
    const u = await this.usersService.findById(req.user.id);
    return {
      gmailConnected: !!u?.gmailConnectedAt,
      lastScanAt: u?.gmailLastScanAt?.toISOString() ?? null,
      lastImportCount: u?.gmailLastImportCount ?? null,
    };
  }

  /**
   * Server-side bookkeeping when user disconnects on the client.
   * Idempotent. Mobile is responsible for revoking with Google and clearing
   * Keychain; this endpoint just clears `gmail_*` columns.
   * Imported subscriptions are intentionally NOT deleted — they belong to
   * the user now, like manually-added ones.
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('disconnect')
  @HttpCode(200)
  async disconnect(@Req() req) {
    await this.dataSource
      .createQueryBuilder()
      .update(User)
      .set({
        gmailConnectedAt: null,
        gmailLastScanAt: null,
        gmailLastImportCount: null,
      })
      .where('id = :id', { id: req.user.id })
      .execute();
    return { ok: true };
  }

  /**
   * Update saved import-count after the mobile bulk-confirm save flow.
   * Called only when the user actually persists subscriptions from a scan.
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RequireProGuard)
  @Post('record-import')
  @HttpCode(200)
  async recordImport(@Body() body: { count: number }, @Req() req) {
    const count = Math.max(0, Math.min(800, Number(body?.count) || 0));
    await this.dataSource
      .createQueryBuilder()
      .update(User)
      .set({ gmailLastImportCount: count })
      .where('id = :id', { id: req.user.id })
      .execute();
    return { ok: true };
  }
}
