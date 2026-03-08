import { Controller, Post, Body, Headers, Logger, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { AiService } from '../ai/ai.service';
import { SubscriptionStatus } from './entities/subscription.entity';
import { UsersService } from '../users/users.service';

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
  ) {}

  /**
   * Receives forwarded emails and parses subscription data from them.
   * User forwards any receipt/subscription email to import@subradar.ai
   * Postmark/Resend routes it here as a webhook.
   */
  @Post('inbound')
  @HttpCode(200)
  @ApiOperation({ summary: 'Process inbound forwarded email for subscription import' })
  async handleInbound(@Body() payload: InboundEmail, @Headers('x-import-token') token: string) {
    const to = payload.To ?? '';
    // Extract userId from address: import+{userId}@subradar.ai
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

    // Check if this looks like a subscription/billing email
    const keywords = ['subscription', 'billing', 'receipt', 'invoice', 'renewal', 'charged', 'payment', 'plan', 'monthly', 'annual', 'trial'];
    const lower = combined.toLowerCase();
    const isRelevant = keywords.some((k) => lower.includes(k));

    if (!isRelevant) {
      this.logger.log(`Email import: not a subscription email (${subject}) for user ${userId}`);
      return { ok: false, reason: 'not_subscription_email' };
    }

    // Use AI to parse subscription details from the email text
    let parsed: any;
    try {
      parsed = await this.aiService.parseEmailText(combined);
    } catch (e) {
      this.logger.error(`Email import AI parse failed: ${e}`);
      return { ok: false, reason: 'ai_parse_failed' };
    }

    if (!parsed?.name || !parsed?.amount) {
      this.logger.log(`Email import: AI couldn't extract subscription from "${subject}"`);
      return { ok: false, reason: 'not_enough_data' };
    }

    // Create subscription if not duplicate
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
   * Frontend calls this to show the user their personal import address.
   */
  @Post('address')
  @HttpCode(200)
  getImportAddress(@Body() body: { userId: string }) {
    return {
      email: `import+${body.userId}@subradar.ai`,
      instructions: 'Forward any subscription receipt to this address and we\'ll import it automatically.',
    };
  }
}
