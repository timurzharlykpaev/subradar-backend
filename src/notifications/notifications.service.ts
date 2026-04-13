import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { Resend } from 'resend';
import Expo, { ExpoPushMessage } from 'expo-server-sdk';
import { buildPaymentReminderHtml, buildWeeklyDigestHtml } from './email-templates';
import { AnalysisResult } from '../analysis/entities/analysis-result.entity';
import { UnsubscribeController } from './unsubscribe.controller';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend | null = null;
  private readonly fromEmail: string;
  private readonly expo = new Expo();

  constructor(
    @InjectQueue('notifications') private readonly queue: Queue,
    private readonly cfg: ConfigService,
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

  async scheduleReminderNotification(
    jobData: {
      userId: string;
      fcmToken?: string;
      email: string;
      subscriptionName: string;
      amount: number;
      currency: string;
      daysUntilBilling: number;
      billingDate: string;
    },
    delayMs = 0,
  ) {
    return this.queue.add('send-reminder', jobData, {
      delay: delayMs,
      attempts: 3,
    });
  }

  async sendPushNotification(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    // Route by token type
    if (Expo.isExpoPushToken(token)) {
      // Expo Push Token: "ExponentPushToken[xxx]"
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
          const receipts = await this.expo.sendPushNotificationsAsync(chunk);
          this.logger.log(`Expo push sent: ${JSON.stringify(receipts)}`);
        } catch (e) {
          this.logger.error(`Expo push failed: ${e}`);
        }
      }
      return;
    }

    // Firebase FCM / APNs native token (legacy)
    if (!admin.apps.length) {
      this.logger.warn('Firebase not initialized, skipping push');
      return;
    }
    return admin.messaging().send({
      token,
      notification: { title, body },
      data,
    });
  }

  async sendEmail(to: string, subject: string, html: string, headers?: Record<string, string>) {
    if (!this.resend) {
      this.logger.warn(`Email not sent to ${to} — RESEND_API_KEY not configured`);
      return;
    }
    return this.resend.emails.send({
      from: this.fromEmail,
      to,
      subject,
      html,
      headers,
    } as any);
  }

  async sendBillingReminderEmail(
    to: string,
    subscriptionName: string,
    amount: number,
    currency: string,
    date: string,
  ) {
    return this.sendUpcomingPaymentEmail(
      to,
      subscriptionName,
      amount,
      currency,
      3,
      date,
      'https://app.subradar.ai',
    );
  }

  async sendWeeklyDigest(
    user: { id: string; email: string; name?: string; locale?: string },
    result: AnalysisResult,
  ) {
    const locale = user.locale ?? 'ru';
    const isRu = (locale).split('-')[0].toLowerCase() === 'ru';
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

    // Build signed one-click unsubscribe URL
    const apiUrl = this.cfg.get('PUBLIC_API_URL', 'https://api.subradar.ai/api/v1');
    const signingSecret = this.cfg.get('JWT_ACCESS_SECRET', '') || 'fallback-unsubscribe-secret';
    const sig = UnsubscribeController.sign(user.id, 'weekly_digest', signingSecret);
    const unsubscribeUrl = `${apiUrl}/unsubscribe?uid=${user.id}&type=weekly_digest&sig=${sig}`;

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

    // Add List-Unsubscribe headers for Gmail/Apple Mail one-click unsubscribe
    const headers = {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
    return this.sendEmail(user.email, subject, html, headers);
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
  ) {
    const daysText = daysLeft === 1 ? 'день' : `${daysLeft} дня`;
    const subject = locale.startsWith('ru')
      ? `⏰ SubRadar: ${name} спишется через ${daysText}`
      : `⏰ SubRadar: ${name} charges in ${daysLeft === 1 ? '1 day' : `${daysLeft} days`}`;

    const html = buildPaymentReminderHtml(name, name, amount, currency, daysLeft, date, locale);
    return this.sendEmail(to, subject, html);
  }
}
