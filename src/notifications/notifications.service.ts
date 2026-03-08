import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { Resend } from 'resend';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend | null = null;
  private readonly fromEmail: string;

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
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    if (!admin.apps.length) return;

    return admin.messaging().send({
      token: fcmToken,
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
    appUrl: string,
  ) {
    const daysText = daysLeft === 1 ? 'день' : `${daysLeft} дня`;
    const subject = `⏰ SubRadar: ${name} спишется через ${daysText}`;
    const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#0f0f1a;font-family:'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f1a;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">
                Sub<span style="color:#8B5CF6;">Radar</span>
              </span>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:16px;border:1px solid rgba(139,92,246,0.3);padding:40px;box-shadow:0 0 40px rgba(139,92,246,0.1);">
              <!-- Header -->
              <p style="margin:0 0 8px 0;font-size:13px;color:#8B5CF6;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Напоминание о платеже</p>
              <h1 style="margin:0 0 24px 0;font-size:22px;color:#ffffff;font-weight:700;line-height:1.3;">
                ⏰ <strong>${name}</strong> спишется через <span style="color:#8B5CF6;">${daysText}</span>
              </h1>
              <!-- Info block -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:rgba(139,92,246,0.1);border-radius:12px;border:1px solid rgba(139,92,246,0.2);padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color:#a0a0b8;font-size:13px;padding-bottom:12px;">Подписка</td>
                        <td align="right" style="color:#ffffff;font-size:13px;font-weight:600;padding-bottom:12px;">${name}</td>
                      </tr>
                      <tr>
                        <td style="color:#a0a0b8;font-size:13px;padding-bottom:12px;">Сумма</td>
                        <td align="right" style="color:#8B5CF6;font-size:18px;font-weight:700;padding-bottom:12px;">${amount} ${currency}</td>
                      </tr>
                      <tr>
                        <td style="color:#a0a0b8;font-size:13px;">Дата списания</td>
                        <td align="right" style="color:#ffffff;font-size:13px;font-weight:600;">${date}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${appUrl}" style="display:inline-block;background:linear-gradient(135deg,#8B5CF6,#6D28D9);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:10px;letter-spacing:0.3px;">
                      Открыть SubRadar →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:13px;color:#4a4a6a;line-height:1.6;">
                Управляй подписками умнее с <strong style="color:#8B5CF6;">SubRadar AI</strong><br/>
                <a href="${appUrl}/settings?tab=notifications" style="color:#6D28D9;text-decoration:none;font-size:12px;">Отписаться от уведомлений</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
    return this.sendEmail(to, subject, html);
  }
}
