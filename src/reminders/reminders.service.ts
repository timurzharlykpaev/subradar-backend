import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Subscription, SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron('0 9 * * *')
  async sendDailyReminders() {
    this.logger.log('Running daily billing reminders cron...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const in1Day = new Date(today);
    in1Day.setDate(today.getDate() + 1);

    const in3Days = new Date(today);
    in3Days.setDate(today.getDate() + 3);

    const subscriptions = await this.subscriptionRepo
      .createQueryBuilder('sub')
      .where('sub.status IN (:...statuses)', {
        statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL],
      })
      .andWhere('sub.nextPaymentDate IN (:...dates)', {
        dates: [
          in1Day.toISOString().split('T')[0],
          in3Days.toISOString().split('T')[0],
        ],
      })
      .getMany();

    this.logger.log(`Found ${subscriptions.length} subscriptions due for reminders`);

    let sent = 0;
    let errors = 0;

    for (const sub of subscriptions) {
      try {
        const user = await this.userRepo.findOne({ where: { id: sub.userId } });
        if (!user) continue;
        if (!user.notificationsEnabled) continue;

        const paymentDate = new Date(sub.nextPaymentDate);
        if (isNaN(paymentDate.getTime())) continue;
        const diffMs = paymentDate.getTime() - today.getTime();
        const daysLeft = Math.round(diffMs / (1000 * 60 * 60 * 24));
        const dateStr = paymentDate.toISOString().split('T')[0];

        // Send email (check emailNotifications preference)
        const emailEnabled = (user as any).emailNotifications !== false;
        if (emailEnabled) {
          await this.notificationsService.sendUpcomingPaymentEmail(
            user.email,
            sub.name,
            Number(sub.amount),
            sub.currency,
            daysLeft,
            dateStr,
            'https://app.subradar.ai',
            (user as any).locale ?? 'ru',
          );
        }

        // Send push if fcmToken exists
        if (user.fcmToken) {
          const title = `⏰ ${sub.name} спишется через ${daysLeft} ${daysLeft === 1 ? 'день' : 'дня'}`;
          const body = `${sub.amount} ${sub.currency} · ${dateStr}`;
          await this.notificationsService.sendPushNotification(
            user.fcmToken,
            title,
            body,
          );
        }

        sent++;
      } catch (err) {
        errors++;
        this.logger.error(`Failed to send reminder for sub ${sub.id}:`, err);
      }
    }

    this.logger.log(`Reminders sent: ${sent}, errors: ${errors}`);
  }

  /** Notify users whose trial is about to expire — runs daily at 10:00 */
  @Cron('0 10 * * *')
  async sendTrialExpiryReminders() {
    this.logger.log('Running trial expiry reminders cron...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const in1Day = new Date(today);
    in1Day.setDate(today.getDate() + 1);

    const in4Days = new Date(today);
    in4Days.setDate(today.getDate() + 4);

    const users = await this.userRepo
      .createQueryBuilder('u')
      .where("u.plan = 'pro'")
      .andWhere('u.trialUsed = true')
      .andWhere('u.lemonSqueezyCustomerId IS NULL')
      .andWhere('u.trialEndDate IS NOT NULL')
      .getMany();

    let sent = 0;
    let errors = 0;

    for (const user of users) {
      try {
        if (!user.trialEndDate) continue;

        const trialEnd = new Date(user.trialEndDate);
        trialEnd.setHours(0, 0, 0, 0);

        const diffMs = trialEnd.getTime() - today.getTime();
        const daysLeft = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (daysLeft !== 1 && daysLeft !== 4) continue;
        if (!user.notificationsEnabled) continue;

        const title = `Your Pro trial ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`;
        const body =
          'Upgrade now to keep unlimited subscriptions and AI features';

        if (user.fcmToken) {
          await this.notificationsService.sendPushNotification(
            user.fcmToken,
            title,
            body,
          );
        }

        sent++;
      } catch (err) {
        errors++;
        this.logger.error(
          `Failed to send trial expiry reminder for user ${user.id}:`,
          err,
        );
      }
    }

    this.logger.log(
      `Trial expiry reminders sent: ${sent}, errors: ${errors}`,
    );
  }

  /** Downgrade users whose trial has expired — runs every hour */
  @Cron('0 * * * *')
  async expireTrials() {
    const expired = await this.userRepo
      .createQueryBuilder('u')
      .where("u.plan = 'pro'")
      .andWhere('u.trialUsed = true')
      .andWhere('u.trialEndDate < NOW()')
      .andWhere('u.lemonSqueezyCustomerId IS NULL')
      .getMany();

    for (const user of expired) {
      await this.userRepo.update(user.id, { plan: 'free' } as any);
      this.logger.log(`Trial expired → downgraded to free: ${user.email}`);
    }
    if (expired.length > 0) {
      this.logger.log(`Expired ${expired.length} trials`);
    }
  }
}
