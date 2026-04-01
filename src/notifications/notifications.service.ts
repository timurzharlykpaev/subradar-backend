import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { Resend } from 'resend';
import Expo, { ExpoPushMessage } from 'expo-server-sdk';
import { buildPaymentReminderHtml } from './email-templates';

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

  async sendEmail(to: string, subject: string, html: string) {
    if (!this.resend) {
      this.logger.warn(`Email not sent to ${to} — RESEND_API_KEY not configured`);
      return;
    }
    return this.resend.emails.send({
      from: this.fromEmail,
      to,
      subject,
      html,
    });
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
