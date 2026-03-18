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

        const paymentDate = sub.nextPaymentDate as Date;
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
