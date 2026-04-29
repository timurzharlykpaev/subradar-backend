import { Controller, Get, Logger, Query, Res, BadRequestException, Post, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { UsersService } from '../users/users.service';

const SUPPORTED_TYPES = ['weekly_digest', 'email_notifications', 'all'] as const;
type UnsubType = (typeof SUPPORTED_TYPES)[number];

/**
 * Public unsubscribe controller — NO auth required (CAN-SPAM / GDPR compliance).
 * URL format: /api/v1/unsubscribe?uid=<userId>&type=<type>&sig=<hmac>
 * Signature is HMAC-SHA256(`${uid}:${type}`, secret).
 */
@Controller('unsubscribe')
export class UnsubscribeController {
  private static readonly logger = new Logger('UnsubscribeController');
  private readonly secret: string;
  /**
   * When the migration to a dedicated UNSUBSCRIBE_SECRET is in flight we
   * keep accepting links signed with the old JWT_ACCESS_SECRET so emails
   * already in inboxes don't 400 their "unsubscribe" link. New emails are
   * always signed with the new secret. Drop this once the older email
   * cohort has expired (~2 weeks).
   */
  private readonly legacySecret: string | null;

  constructor(
    private readonly cfg: ConfigService,
    private readonly usersService: UsersService,
  ) {
    // Dedicated unsubscribe secret. Sharing the JWT signing key meant a
    // compromise of one secret leaked the ability to forge both auth
    // tokens AND unsubscribe URLs for any userId — link forgery here is
    // particularly bad because a single GET silently kills user emails.
    const dedicated = cfg.get<string>('UNSUBSCRIBE_SECRET', '');
    if (dedicated) {
      this.secret = dedicated;
    } else {
      // Fall back to JWT_ACCESS_SECRET only outside production so local /
      // dev environments stay bootable without yet another env var. In
      // prod we throw at startup so the misconfiguration is impossible
      // to miss.
      const env = (cfg.get<string>('NODE_ENV', '') || '').toLowerCase();
      if (env === 'production') {
        throw new Error(
          'UNSUBSCRIBE_SECRET is required in production — refusing to boot.',
        );
      }
      const jwt = cfg.get<string>('JWT_ACCESS_SECRET', '');
      this.secret = jwt || 'fallback-unsubscribe-secret';
      UnsubscribeController.logger.warn(
        'UNSUBSCRIBE_SECRET not set — falling back to JWT_ACCESS_SECRET (dev only)',
      );
    }
    const jwtForLegacy = cfg.get<string>('JWT_ACCESS_SECRET', '');
    this.legacySecret = jwtForLegacy && jwtForLegacy !== this.secret ? jwtForLegacy : null;
  }

  /**
   * Generate signed unsubscribe URL for a user.
   * Called from email templates.
   */
  static sign(userId: string, type: UnsubType, secret: string): string {
    const payload = `${userId}:${type}`;
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  private verifyAgainst(userId: string, type: UnsubType, sig: string, secret: string): boolean {
    const expected = UnsubscribeController.sign(userId, type, secret);
    const aBuf = Buffer.from(sig);
    const bBuf = Buffer.from(expected);
    if (aBuf.length !== bBuf.length) return false;
    try {
      return timingSafeEqual(aBuf, bBuf);
    } catch {
      return false;
    }
  }

  private verify(userId: string, type: UnsubType, sig: string): boolean {
    if (!userId || !type || !sig) return false;
    if (this.verifyAgainst(userId, type, sig, this.secret)) return true;
    if (this.legacySecret && this.verifyAgainst(userId, type, sig, this.legacySecret)) {
      // Legitimate legacy link — accept but log so we know how soon the
      // legacy fallback can be retired.
      UnsubscribeController.logger.log(
        `unsubscribe: legacy-signed link accepted for uid=${userId} type=${type}`,
      );
      return true;
    }
    return false;
  }

  @Get()
  async unsubscribe(
    @Query('uid') uid: string,
    @Query('type') type: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    if (!SUPPORTED_TYPES.includes(type as UnsubType)) {
      return res.status(400).send(this.renderPage('Invalid unsubscribe link', false));
    }
    if (!this.verify(uid, type as UnsubType, sig)) {
      return res.status(400).send(this.renderPage('Invalid or expired unsubscribe link', false));
    }

    const user = await this.usersService.findById(uid).catch(() => null);
    if (!user) {
      return res.status(404).send(this.renderPage('User not found', false));
    }

    const updates: any = {};
    if (type === 'weekly_digest' || type === 'all') updates.weeklyDigestEnabled = false;
    if (type === 'email_notifications' || type === 'all') updates.emailNotifications = false;
    await this.usersService.update(uid, updates);

    const label = type === 'weekly_digest'
      ? 'weekly AI digest emails'
      : type === 'email_notifications'
      ? 'email notifications'
      : 'all emails';

    return res.status(200).send(this.renderPage(
      `You've been unsubscribed from ${label}.`,
      true,
      uid,
      type as UnsubType,
    ));
  }

  @Post('resubscribe/:uid/:type')
  async resubscribe(
    @Param('uid') uid: string,
    @Param('type') type: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    if (!SUPPORTED_TYPES.includes(type as UnsubType)) {
      throw new BadRequestException('Invalid type');
    }
    if (!this.verify(uid, type as UnsubType, sig)) {
      throw new BadRequestException('Invalid signature');
    }
    const user = await this.usersService.findById(uid).catch(() => null);
    if (!user) throw new BadRequestException('User not found');

    const updates: any = {};
    if (type === 'weekly_digest' || type === 'all') updates.weeklyDigestEnabled = true;
    if (type === 'email_notifications' || type === 'all') updates.emailNotifications = true;
    await this.usersService.update(uid, updates);

    return res.status(200).send(this.renderPage('Welcome back! You are resubscribed.', true));
  }

  private renderPage(message: string, success: boolean, uid?: string, type?: UnsubType): string {
    const color = success ? '#10B981' : '#EF4444';
    const icon = success ? '✓' : '⚠';
    const appUrl = this.cfg.get('APP_URL', 'https://subradar.ai');
    const resubscribeSig = uid && type ? UnsubscribeController.sign(uid, type, this.secret) : '';
    const resubscribeBtn = success && uid && type ? `
      <form method="POST" action="/api/v1/unsubscribe/resubscribe/${uid}/${type}?sig=${resubscribeSig}" style="margin-top:20px;">
        <button type="submit" style="background:#8B5CF6;color:#FFF;border:none;padding:12px 24px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;">Subscribe back</button>
      </form>
    ` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SubRadar — Unsubscribe</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F4F4F8; margin: 0; padding: 20px; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: #FFF; border-radius: 20px; padding: 40px 32px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.08); }
  .icon { width: 72px; height: 72px; border-radius: 36px; background: ${color}20; color: ${color}; font-size: 36px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-weight: 700; }
  h1 { margin: 0 0 12px; font-size: 22px; color: #111827; font-weight: 800; }
  p { margin: 0; font-size: 14px; color: #6B7280; line-height: 1.5; }
  .footer { margin-top: 24px; font-size: 12px; color: #9CA3AF; }
  a { color: #8B5CF6; text-decoration: none; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${message}</h1>
    <p>You can manage your email preferences anytime in the SubRadar app settings.</p>
    ${resubscribeBtn}
    <div class="footer">
      <a href="${appUrl}">Return to SubRadar</a>
    </div>
  </div>
</body>
</html>`;
  }
}
