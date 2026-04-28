import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as admin from 'firebase-admin';
import { Resend } from 'resend';
import Expo, { ExpoPushMessage } from 'expo-server-sdk';
import { buildPaymentReminderHtml, buildWeeklyDigestHtml } from './email-templates';
import { AnalysisResult } from '../analysis/entities/analysis-result.entity';
import { User } from '../users/entities/user.entity';
import { UnsubscribeController } from './unsubscribe.controller';
import { SuppressionService } from './suppression.service';
import { maskEmail } from '../common/utils/pii';

/** FCM error codes that mean the token is dead and must be cleared. */
const FCM_DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/** Expo receipt error codes that mean the token is dead. */
const EXPO_DEAD_TOKEN_CODES = new Set([
  'DeviceNotRegistered',
  'InvalidCredentials',
]);

type UnsubType = 'weekly_digest' | 'email_notifications' | 'all';

interface SendOpts {
  /**
   * Optional userId. When provided we (a) auto-attach List-Unsubscribe headers
   * pointing at the HMAC-signed unsubscribe URL, and (b) record audit context.
   * Magic links and other purely-transactional emails can omit this.
   */
  userId?: string;
  /** Type of email — drives which preference toggle the unsubscribe link flips. */
  unsubType?: UnsubType;
  /** Extra headers to merge with the auto-generated ones. */
  headers?: Record<string, string>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend | null = null;
  private readonly fromEmail: string;
  private readonly expo = new Expo();

  constructor(
    private readonly cfg: ConfigService,
    private readonly suppression: SuppressionService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    const apiKey = cfg.get<string>('RESEND_API_KEY', '');
    this.fromEmail = cfg.get<string>('RESEND_FROM_EMAIL', 'noreply@subradar.ai');

    if (apiKey && !apiKey.includes('placeholder')) {
      this.resend = new Resend(apiKey);
    }

    // Initialize Firebase Admin only once
    if (!admin.apps.length) {
      const projectId = cfg.get('FIREBASE_PROJECT_ID');
      const privateKey = cfg.get('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
      const clientEmail = cfg.get('FIREBASE_CLIENT_EMAIL');

      if (projectId && privateKey && clientEmail) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            privateKey,
            clientEmail,
          }),
        });
      }
    }
  }

  /**
   * Send a push to a single token. When the device returns a "dead token"
   * error (FCM `registration-token-not-registered`, Expo `DeviceNotRegistered`)
   * we null the user's `fcmToken` so we stop wasting quota on uninstalled
   * apps. Without this every cron tick keeps hitting the same dead tokens
   * forever, eventually getting us throttled by FCM.
   *
   * `userId` is optional for backward compat — without it we can't clear
   * the token but still send. Pass it from cron callsites.
   */
  async sendPushNotification(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    userId?: string,
  ) {
    if (Expo.isExpoPushToken(token)) {
      const message: ExpoPushMessage = {
        to: token,
        title,
        body,
        data: data ?? {},
        sound: 'default',
        priority: 'high',
      };
      const chunks = this.expo.chunkPushNotifications([message]);
      for (const chunk of chunks) {
        try {
          const tickets = await this.expo.sendPushNotificationsAsync(chunk);
          this.logger.log(`Expo push sent: ${JSON.stringify(tickets)}`);
          for (const ticket of tickets) {
            if (
              ticket.status === 'error' &&
              ticket.details?.error &&
              EXPO_DEAD_TOKEN_CODES.has(ticket.details.error)
            ) {
              await this.clearDeadToken(userId, token, ticket.details.error);
            }
          }
        } catch (e) {
          this.logger.error(`Expo push failed: ${e}`);
        }
      }
      return;
    }

    if (!admin.apps.length) {
      this.logger.warn('Firebase not initialized, skipping push');
      return;
    }
    try {
      return await admin.messaging().send({
        token,
        notification: { title, body },
        data,
      });
    } catch (err: any) {
      const code: string = err?.errorInfo?.code ?? err?.code ?? '';
      if (FCM_DEAD_TOKEN_CODES.has(code)) {
        await this.clearDeadToken(userId, token, code);
        return;
      }
      this.logger.error(`FCM send failed (code=${code}): ${err?.message ?? err}`);
      throw err;
    }
  }

  /**
   * Null out a dead push token. We match by token (not just userId) so a
   * user who already re-registered a fresh token doesn't lose it because
   * a stale push came back with the previous one. Best-effort — failures
   * here are non-fatal.
   */
  private async clearDeadToken(
    userId: string | undefined,
    token: string,
    reason: string,
  ): Promise<void> {
    try {
      const where = userId ? { id: userId, fcmToken: token } : { fcmToken: token };
      const res = await this.userRepo.update(where as any, { fcmToken: null as any });
      if ((res?.affected ?? 0) > 0) {
        this.logger.warn(
          `Cleared dead push token (reason=${reason}, userId=${userId ?? 'unknown'})`,
        );
      }
    } catch (err: any) {
      this.logger.warn(`clearDeadToken failed: ${err?.message ?? err}`);
    }
  }

  /**
   * Build the HMAC-signed unsubscribe URL for a (user, type) pair. Used both
   * for the `List-Unsubscribe` header and the in-template unsubscribe link.
   */
  buildUnsubscribeUrl(userId: string, type: UnsubType): string {
    const apiUrl = this.cfg.get(
      'PUBLIC_API_URL',
      'https://api.subradar.ai/api/v1',
    );
    const signingSecret =
      this.cfg.get('JWT_ACCESS_SECRET', '') || 'fallback-unsubscribe-secret';
    const sig = UnsubscribeController.sign(userId, type, signingSecret);
    return `${apiUrl}/unsubscribe?uid=${userId}&type=${type}&sig=${sig}`;
  }

  /**
   * Send an email via Resend. Three guarantees added on top of the raw API:
   *   1. Suppression list is checked FIRST — bouncing/unsubscribed addresses
   *      are silently dropped before we even hit Resend (sender-reputation safety).
   *   2. When `opts.userId` is provided we auto-attach `List-Unsubscribe` and
   *      `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers — the
   *      Feb 2024 Gmail/Yahoo bulk-sender requirement.
   *   3. PII-safe logging — addresses are masked in any log lines we emit.
   */
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    opts: SendOpts = {},
  ) {
    if (!this.resend) {
      this.logger.warn(
        `Email not sent to ${maskEmail(to)} — RESEND_API_KEY not configured`,
      );
      return;
    }
    if (await this.suppression.isSuppressed(to)) {
      this.logger.warn(
        `Email skipped — ${maskEmail(to)} is on the suppression list`,
      );
      return;
    }

    let headers: Record<string, string> | undefined = opts.headers
      ? { ...opts.headers }
      : undefined;
    if (opts.userId) {
      const unsubType: UnsubType = opts.unsubType ?? 'all';
      const unsubUrl = this.buildUnsubscribeUrl(opts.userId, unsubType);
      headers = {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        ...(headers ?? {}),
      };
    }

    try {
      return await this.resend.emails.send({
        from: this.fromEmail,
        to,
        subject,
        html,
        headers,
      } as any);
    } catch (err: any) {
      this.logger.error(
        `Resend send failed to ${maskEmail(to)} (subject="${subject.slice(0, 60)}"): ${
          err?.message ?? err
        }`,
      );
      throw err;
    }
  }

  async sendBillingReminderEmail(
    to: string,
    subscriptionName: string,
    amount: number,
    currency: string,
    date: string,
    userId?: string,
  ) {
    return this.sendUpcomingPaymentEmail(
      to,
      subscriptionName,
      amount,
      currency,
      3,
      date,
      'https://app.subradar.ai',
      'ru',
      userId,
    );
  }

  async sendWeeklyDigest(
    user: { id: string; email: string; name?: string; locale?: string },
    result: AnalysisResult,
  ) {
    const locale = user.locale ?? 'ru';
    const isRu = locale.split('-')[0].toLowerCase() === 'ru';
    const name = user.name ?? user.email;

    const savings = Number(result.totalMonthlySavings);
    const fmtSavings = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: result.currency || 'USD',
      maximumFractionDigits: 2,
    }).format(isNaN(savings) || !isFinite(savings) ? 0 : savings);

    const subject = isRu
      ? `📊 SubRadar: ваш дайджест — сэкономьте ${fmtSavings}/мес`
      : `📊 SubRadar: your digest — save ${fmtSavings}/mo`;

    const unsubscribeUrl = this.buildUnsubscribeUrl(user.id, 'weekly_digest');
    const html = buildWeeklyDigestHtml(
      name,
      result.summary,
      savings,
      result.currency,
      result.subscriptionCount,
      savings,
      result.recommendations ?? [],
      locale,
      'https://app.subradar.ai',
      unsubscribeUrl,
    );

    return this.sendEmail(user.email, subject, html, {
      userId: user.id,
      unsubType: 'weekly_digest',
    });
  }

  async sendUpcomingPaymentEmail(
    to: string,
    name: string,
    amount: number,
    currency: string,
    daysLeft: number,
    date: string,
    _appUrl: string,
    locale = 'ru',
    userId?: string,
  ) {
    const daysText = daysLeft === 1 ? 'день' : `${daysLeft} дня`;
    const subject = locale.startsWith('ru')
      ? `⏰ SubRadar: ${name} спишется через ${daysText}`
      : `⏰ SubRadar: ${name} charges in ${daysLeft === 1 ? '1 day' : `${daysLeft} days`}`;

    const unsubscribeUrl = userId
      ? this.buildUnsubscribeUrl(userId, 'email_notifications')
      : null;
    const html = buildPaymentReminderHtml(
      name,
      name,
      amount,
      currency,
      daysLeft,
      date,
      locale,
      unsubscribeUrl,
    );
    return this.sendEmail(to, subject, html, {
      userId,
      unsubType: 'email_notifications',
    });
  }
}
