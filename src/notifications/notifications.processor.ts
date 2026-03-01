import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { NotificationsService } from './notifications.service';

@Processor('notifications')
export class NotificationsProcessor {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly service: NotificationsService) {}

  @Process('send-reminder')
  async handleReminder(job: Job) {
    const { fcmToken, email, subscriptionName, amount, currency, billingDate } = job.data;
    this.logger.log(`Processing reminder for ${subscriptionName}`);

    try {
      // Send push notification if FCM token available
      if (fcmToken) {
        await this.service.sendPushNotification(
          fcmToken,
          '🔔 Upcoming Billing',
          `${subscriptionName} will be charged ${currency} ${amount} on ${billingDate}`,
          { subscriptionName, amount: String(amount), billingDate },
        );
      }

      // Always send email
      if (email) {
        await this.service.sendBillingReminderEmail(email, subscriptionName, amount, currency, billingDate);
      }
    } catch (error) {
      this.logger.error(`Failed to send reminder: ${error.message}`);
      throw error;
    }
  }
}
