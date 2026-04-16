import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';
import { toZonedTime } from 'date-fns-tz';
import { Subscription, SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramAlertService } from '../common/telegram-alert.service';
import { runCronHandler } from '../common/cron/run-cron-handler';

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly tg: TelegramAlertService,
  ) {}

  @Cron('0 9 * * *')
  async sendDailyReminders() {
    return runCronHandler('sendDailyReminders', this.logger, this.tg, () =>
      this.sendDailyRemindersImpl(),
    );
  }

  private async sendDailyRemindersImpl() {
    this.logger.log('Running daily billing reminders cron...');

    // Widen the SQL window to ±1 day of UTC today to cover users in tz offsets
    // that shift the calendar boundary (e.g. UTC-12 / UTC+14). The exact per-user
    // daysLeft comparison happens in the user's detected timezone below.
    const utcToday = new Date();
    utcToday.setUTCHours(0, 0, 0, 0);
    const utcFrom = new Date(utcToday.getTime() - 86400000);
    const utcTo = new Date(utcToday.getTime() + 8 * 86400000);

    const subscriptions = await this.subscriptionRepo
      .createQueryBuilder('sub')
      .where('sub.status IN (:...statuses)', {
        statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL],
      })
      .andWhere('sub.nextPaymentDate BETWEEN :from AND :to', {
        from: utcFrom.toISOString().split('T')[0],
        to: utcTo.toISOString().split('T')[0],
      })
      .andWhere('sub.reminderEnabled = true')
      .getMany();

    this.logger.log(`Found ${subscriptions.length} subscriptions with reminders in next 7 days`);

    let sent = 0;
    let errors = 0;

    for (const sub of subscriptions) {
      try {
        const user = await this.userRepo.findOne({ where: { id: sub.userId } });
        if (!user) continue;
        if (!user.notificationsEnabled) continue;

        const paymentDate = new Date(sub.nextPaymentDate);
        if (isNaN(paymentDate.getTime())) continue;

        // Compute daysLeft in the user's timezone so "1 day before" lines up with
        // their local calendar, not the server's UTC day.
        const userTz = user.timezoneDetected || user.timezone || 'UTC';
        const nowInUserTz = toZonedTime(new Date(), userTz);
        const todayInUserTz = new Date(
          nowInUserTz.getFullYear(),
          nowInUserTz.getMonth(),
          nowInUserTz.getDate(),
        );
        const paymentInUserTz = toZonedTime(paymentDate, userTz);
        const paymentDayInUserTz = new Date(
          paymentInUserTz.getFullYear(),
          paymentInUserTz.getMonth(),
          paymentInUserTz.getDate(),
        );
        const daysLeft = Math.floor(
          (paymentDayInUserTz.getTime() - todayInUserTz.getTime()) / 86400000,
        );
        if (daysLeft < 0) continue;
        const dateStr = paymentDate.toISOString().split('T')[0];

        // Check if today matches one of the subscription's reminder days
        const reminderDays: number[] = (sub as any).reminderDaysBefore ?? [1, 3];
        if (!reminderDays.includes(daysLeft)) continue;

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
    return runCronHandler('sendTrialExpiryReminders', this.logger, this.tg, () =>
      this.sendTrialExpiryRemindersImpl(),
    );
  }

  private async sendTrialExpiryRemindersImpl() {
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

  /** Notify users whose Pro subscription is about to expire — runs daily at 10:00 UTC */
  @Cron('0 10 * * *')
  async sendProExpirationReminders() {
    return runCronHandler('sendProExpirationReminders', this.logger, this.tg, () =>
      this.sendProExpirationRemindersImpl(),
    );
  }

  private async sendProExpirationRemindersImpl() {
    this.logger.log('Running Pro expiration reminders cron...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find users with cancelAtPeriodEnd=true and currentPeriodEnd in the future (or today)
    const users = await this.userRepo
      .createQueryBuilder('u')
      .where('u.cancelAtPeriodEnd = true')
      .andWhere('u.currentPeriodEnd IS NOT NULL')
      .andWhere("u.plan != 'free'")
      .getMany();

    let sent = 0;
    let errors = 0;

    for (const user of users) {
      try {
        if (!user.currentPeriodEnd) continue;
        if (!user.notificationsEnabled) continue;

        const periodEnd = new Date(user.currentPeriodEnd);
        periodEnd.setHours(0, 0, 0, 0);

        const diffMs = periodEnd.getTime() - today.getTime();
        const daysLeft = Math.round(diffMs / (1000 * 60 * 60 * 24));

        // Send at 7 days, 3 days, 1 day before, and on expiration day (0)
        if (![7, 3, 1, 0].includes(daysLeft)) continue;

        let title: string;
        let body: string;

        if (daysLeft === 0) {
          title = 'SubRadar Pro';
          body = 'Your Pro benefits have ended';
        } else if (daysLeft === 1) {
          title = 'SubRadar Pro';
          body = 'Last day of Pro!';
        } else {
          title = 'SubRadar Pro';
          body = `Your Pro subscription ends in ${daysLeft} days`;
        }

        // Send push notification
        if (user.fcmToken) {
          await this.notificationsService.sendPushNotification(
            user.fcmToken,
            title,
            body,
            { screen: '/paywall' },
          );
        }

        // Send email only for 7-day reminder
        if (daysLeft === 7) {
          const emailEnabled = user.emailNotifications !== false;
          if (emailEnabled) {
            const subject = 'Your SubRadar Pro subscription ends in 7 days';
            const html = `
              <h2>Your Pro subscription is ending soon</h2>
              <p>Hi${user.name ? ` ${user.name}` : ''},</p>
              <p>Your SubRadar Pro subscription will end in 7 days. After that, you'll lose access to unlimited subscriptions and AI features.</p>
              <p><a href="https://app.subradar.ai">Renew your subscription</a> to keep your Pro benefits.</p>
              <p>— SubRadar Team</p>
            `;
            await this.notificationsService.sendEmail(user.email, subject, html);
          }
        }

        sent++;
      } catch (err) {
        errors++;
        this.logger.error(
          `Failed to send Pro expiration reminder for user ${user.id}:`,
          err,
        );
      }
    }

    this.logger.log(
      `Pro expiration reminders sent: ${sent}, errors: ${errors}`,
    );
  }

  /** Weekly push digest — every Sunday at 11:00 UTC */
  @Cron('0 11 * * 0')
  async sendWeeklyPushDigest() {
    return runCronHandler('sendWeeklyPushDigest', this.logger, this.tg, () =>
      this.sendWeeklyPushDigestImpl(),
    );
  }

  private async sendWeeklyPushDigestImpl() {
    this.logger.log('Running weekly push digest...');

    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 86400000);

    // Find active users with push token who opted in to weekly digest
    const users = await this.userRepo
      .createQueryBuilder('u')
      .where('u.fcmToken IS NOT NULL')
      .andWhere('u.notificationsEnabled = true')
      .andWhere('u.weeklyDigestEnabled = true')
      .getMany();

    let sent = 0;

    for (const user of users) {
      try {
        const subs = await this.subscriptionRepo.find({
          where: { userId: user.id },
        });

        const active = subs.filter(
          (s) =>
            s.status === SubscriptionStatus.ACTIVE ||
            s.status === SubscriptionStatus.TRIAL,
        );
        if (active.length === 0) continue;

        // Calc total monthly spend
        const totalMonthly = active.reduce((sum, s) => {
          const amt = Number(s.amount) || 0;
          const period = (s.billingPeriod as string)?.toUpperCase();
          if (period === 'YEARLY') return sum + amt / 12;
          if (period === 'WEEKLY') return sum + amt * 4.33;
          if (period === 'QUARTERLY') return sum + amt / 3;
          return sum + amt;
        }, 0);

        // Count renewals this week
        const renewingThisWeek = active.filter((s) => {
          if (!s.nextPaymentDate) return false;
          const d = new Date(s.nextPaymentDate);
          return d >= now && d <= weekFromNow;
        });

        const currency = active[0]?.currency ?? 'USD';
        const title = `📊 ${currency} ${totalMonthly.toFixed(0)}/mo on ${active.length} subscriptions`;
        const body =
          renewingThisWeek.length > 0
            ? `${renewingThisWeek.length} renewing this week`
            : 'Your weekly subscription summary';

        await this.notificationsService.sendPushNotification(
          user.fcmToken,
          title,
          body,
          { screen: '/(tabs)' },
        );
        sent++;
      } catch (err) {
        this.logger.error(`Weekly digest push failed for ${user.id}:`, err);
      }
    }

    this.logger.log(`Weekly push digests sent: ${sent}`);
  }

  /** Downgrade users whose trial has expired — runs every hour */
  @Cron('0 * * * *')
  async expireTrials() {
    return runCronHandler('expireTrials', this.logger, this.tg, () =>
      this.expireTrialsImpl(),
    );
  }

  private async expireTrialsImpl() {
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

  /** Win-back push for users inactive 7+ days — daily at 14:00 UTC */
  @Cron('0 14 * * *')
  async sendWinBackPush() {
    return runCronHandler('sendWinBackPush', this.logger, this.tg, () =>
      this.sendWinBackPushImpl(),
    );
  }

  private async sendWinBackPushImpl() {
    this.logger.log('Running win-back push cron...');

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

    // Users with push token who haven't been updated in 7+ days (proxy for inactivity)
    const inactiveUsers = await this.userRepo
      .createQueryBuilder('u')
      .where('u.fcmToken IS NOT NULL')
      .andWhere('u.notificationsEnabled = true')
      .andWhere('u.updatedAt < :date', { date: sevenDaysAgo })
      .getMany();

    let sent = 0;

    for (const user of inactiveUsers) {
      try {
        // Check if they have active subs with upcoming renewals
        const weekFromNow = new Date(Date.now() + 7 * 86400000);
        const upcomingSubs = await this.subscriptionRepo
          .createQueryBuilder('sub')
          .where('sub.userId = :userId', { userId: user.id })
          .andWhere('sub.status IN (:...statuses)', {
            statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL],
          })
          .andWhere('sub.nextPaymentDate <= :date', {
            date: weekFromNow.toISOString().split('T')[0],
          })
          .andWhere('sub.nextPaymentDate >= :today', {
            today: new Date().toISOString().split('T')[0],
          })
          .getCount();

        if (upcomingSubs === 0) continue;

        const title = '👀 Don\'t miss upcoming charges';
        const body = `${upcomingSubs} subscription${upcomingSubs > 1 ? 's' : ''} renewing this week`;

        await this.notificationsService.sendPushNotification(
          user.fcmToken,
          title,
          body,
          { screen: '/(tabs)' },
        );
        sent++;
      } catch (err) {
        this.logger.error(`Win-back push failed for ${user.id}:`, err);
      }
    }

    this.logger.log(`Win-back pushes sent: ${sent}`);
  }
}
