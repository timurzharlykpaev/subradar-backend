import {
  Controller,
  Post,
  Req,
  Body,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { SuppressionService } from './suppression.service';
import { maskEmail } from '../common/utils/pii';

/**
 * Handles Resend webhook events.
 *
 * Configure in Resend dashboard → Webhooks:
 *   URL:    https://api.subradar.ai/api/v1/notifications/resend-webhook
 *   Events: email.bounced, email.complained
 *   Secret: stored in RESEND_WEBHOOK_SECRET env (Svix-style signing)
 *
 * On bounce/complaint we add the recipient to the suppression list so
 * NotificationsService.sendEmail() refuses to mail them again. This is the
 * single most important safeguard against domain-wide spam-folder demotion.
 */
@Controller('notifications/resend-webhook')
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);
  private readonly signingSecret: string;

  constructor(
    private readonly cfg: ConfigService,
    private readonly suppression: SuppressionService,
  ) {
    this.signingSecret = cfg.get<string>('RESEND_WEBHOOK_SECRET', '');
    // Fail-fast in production if signing secret is missing — without it any
    // unauthenticated POST could mark arbitrary addresses as bounced and
    // permanently suppress them. In dev we only warn so local runs still
    // boot with a half-configured .env.
    const env = (cfg.get<string>('NODE_ENV', '') || '').toLowerCase();
    if (!this.signingSecret) {
      if (env === 'production') {
        throw new Error(
          'RESEND_WEBHOOK_SECRET is required in production — refusing to boot.',
        );
      }
      this.logger.warn(
        'RESEND_WEBHOOK_SECRET not configured — webhook signatures will NOT be verified (dev only)',
      );
    }
  }

  @Post()
  async handle(@Req() req: Request, @Body() payload: any) {
    if (this.signingSecret) {
      const svixId = req.headers['svix-id'] as string | undefined;
      const svixTs = req.headers['svix-timestamp'] as string | undefined;
      const svixSig = req.headers['svix-signature'] as string | undefined;
      const rawBody = (req as any).rawBody as string | undefined;
      if (!svixId || !svixTs || !svixSig || !rawBody) {
        throw new BadRequestException('Missing Svix signature headers');
      }
      if (!this.verifySvix(svixId, svixTs, rawBody, svixSig)) {
        throw new BadRequestException('Invalid Resend webhook signature');
      }
    }

    const eventType = String(payload?.type ?? '');
    const email = payload?.data?.to?.[0] || payload?.data?.email;
    if (!email) {
      this.logger.warn(`Resend webhook ${eventType} without recipient — ignoring`);
      return { received: true };
    }

    switch (eventType) {
      case 'email.bounced': {
        const bounceType = String(payload?.data?.bounce?.type ?? 'hard');
        const reason = bounceType.toLowerCase().startsWith('soft') ? 'soft_bounce' : 'hard_bounce';
        await this.suppression.suppress(email, reason as any, JSON.stringify(payload?.data?.bounce ?? {}));
        break;
      }
      case 'email.complained':
        await this.suppression.suppress(email, 'complaint', 'spam complaint reported via mailbox provider');
        break;
      default:
        this.logger.debug(
          `Resend webhook ${eventType} for ${maskEmail(email)} — no action`,
        );
    }
    return { received: true };
  }

  private verifySvix(id: string, timestamp: string, body: string, signatureHeader: string): boolean {
    const secret = this.signingSecret.startsWith('whsec_')
      ? this.signingSecret.slice('whsec_'.length)
      : this.signingSecret;
    let key: Buffer;
    try {
      key = Buffer.from(secret, 'base64');
    } catch {
      return false;
    }
    const signedContent = `${id}.${timestamp}.${body}`;
    const expectedSig = createHmac('sha256', key).update(signedContent).digest('base64');

    const candidates = signatureHeader.split(' ').map((s) => s.split(',')[1]).filter(Boolean);
    return candidates.some((cand) => {
      try {
        const a = Buffer.from(cand);
        const b = Buffer.from(expectedSig);
        if (a.length !== b.length) return false;
        return timingSafeEqual(a, b);
      } catch {
        return false;
      }
    });
  }
}
