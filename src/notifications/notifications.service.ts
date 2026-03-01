import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { Resend } from 'resend';

@Injectable()
export class NotificationsService {
  private readonly resend: Resend;
  private readonly fromEmail: string;

  constructor(
    @InjectQueue('notifications') private readonly queue: Queue,
    private readonly cfg: ConfigService,
  ) {
    this.resend = new Resend(cfg.get('RESEND_API_KEY'));
    this.fromEmail = cfg.get('RESEND_FROM_EMAIL', 'noreply@subradar.ai');

    // Initialize Firebase Admin only once
    if (!admin.apps.length) {
      const projectId = cfg.get('FIREBASE_PROJECT_ID');
      const privateKey = cfg.get('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
      const clientEmail = cfg.get('FIREBASE_CLIENT_EMAIL');

      if (projectId && privateKey && clientEmail) {
        admin.initializeApp({
          credential: admin.credential.cert({ projectId, privateKey, clientEmail }),
        });
      }
    }
  }

  async scheduleReminderNotification(jobData: {
    userId: string;
    fcmToken?: string;
    email: string;
    subscriptionName: string;
    amount: number;
    currency: string;
    daysUntilBilling: number;
    billingDate: string;
  }, delayMs = 0) {
    return this.queue.add('send-reminder', jobData, { delay: delayMs, attempts: 3 });
  }

  async sendPushNotification(fcmToken: string, title: string, body: string, data?: Record<string, string>) {
    if (!admin.apps.length) return;

    return admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data,
    });
  }

  async sendEmail(to: string, subject: string, html: string) {
    return this.resend.emails.send({
      from: this.fromEmail,
      to,
      subject,
      html,
    });
  }

  async sendBillingReminderEmail(to: string, subscriptionName: string, amount: number, currency: string, date: string) {
    const html = `
      <h2>Upcoming Subscription Billing</h2>
      <p>Your <strong>${subscriptionName}</strong> subscription will be billed on <strong>${date}</strong>.</p>
      <p>Amount: <strong>${currency} ${amount}</strong></p>
      <p>Log in to SubRadar AI to manage your subscription.</p>
    `;
    return this.sendEmail(to, `Reminder: ${subscriptionName} billing on ${date}`, html);
  }
}
