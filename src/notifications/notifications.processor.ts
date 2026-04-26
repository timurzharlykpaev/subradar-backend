import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { NotificationsService } from './notifications.service';
import { pushT } from './push-i18n';

@Processor('notifications')
export class NotificationsProcessor {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly service: NotificationsService) {}

  @Process('send-reminder')
  async handleReminder(job: Job) {
    const {
      fcmToken,
      email,
      subscriptionName,
      amount,
      currency,
      billingDate,
      locale,
    } = job.data;
    this.logger.log(`Processing reminder for ${subscriptionName}`);

    try {
      if (fcmToken) {
        const { title, body } = pushT(locale).upcomingBilling({
          subscriptionName,
          amount,
          currency,
          billingDate,
        });
        await this.service.sendPushNotification(fcmToken, title, body, {
          subscriptionName,
          amount: String(amount),
          billingDate,
        });
      }

      if (email) {
        await this.service.sendBillingReminderEmail(
          email,
          subscriptionName,
          amount,
          currency,
          billingDate,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to send reminder: ${error.message}`);
      throw error;
    }
  }
}
