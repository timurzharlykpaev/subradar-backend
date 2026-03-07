import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class TrialCheckerCron {
  private readonly logger = new Logger(TrialCheckerCron.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkExpiringTrials() {
    this.logger.log('Checking for expiring trials...');

    const trials = await this.subRepo.find({
      where: { status: SubscriptionStatus.TRIAL },
    });

    const now = Date.now();

    for (const sub of trials) {
      if (!sub.trialEndDate) continue;

      const daysLeft = Math.ceil(
        (new Date(sub.trialEndDate).getTime() - now) / (24 * 60 * 60 * 1000),
      );

      const reminderDays = sub.reminderDaysBefore ?? [1, 3];
      const shouldRemind =
        sub.reminderEnabled !== false && reminderDays.includes(daysLeft);

      if (!shouldRemind) continue;

      try {
        const user = await this.userRepo.findOne({ where: { id: sub.userId } });
        if (!user) continue;

        const title = 'Trial Ending Soon';
        const body =
          daysLeft === 1
            ? `Your ${sub.name} trial ends tomorrow! Cancel now to avoid charges.`
            : `Your ${sub.name} trial ends in ${daysLeft} days.`;

        if (user.fcmToken) {
          await this.notifications.sendPushNotification(
            user.fcmToken,
            title,
            body,
            { subscriptionId: sub.id, type: 'trial_expiring' },
          );
        }

        await this.notifications.sendEmail(
          user.email,
          `${title}: ${sub.name}`,
          `
            <h2>${title}</h2>
            <p>${body}</p>
            <p>Amount after trial: <strong>${sub.currency} ${sub.amount}</strong></p>
            ${sub.cancelUrl ? `<p><a href="${sub.cancelUrl}">Cancel subscription</a></p>` : ''}
            <p>Log in to <a href="https://app.subradar.ai">SubRadar AI</a> to manage your subscriptions.</p>
          `,
        );

        this.logger.log(
          `Sent trial reminder for "${sub.name}" to ${user.email} (${daysLeft} days left)`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to send trial reminder for "${sub.name}": ${err.message}`,
        );
      }
    }

    this.logger.log(`Trial check complete. Processed ${trials.length} trials.`);
  }
}
