import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { buildMonthlyReportHtml } from '../notifications/email-templates';
import { TelegramAlertService } from '../common/telegram-alert.service';
import { runCronHandler } from '../common/cron/run-cron-handler';

@Injectable()
export class MonthlyReportService {
  private readonly logger = new Logger(MonthlyReportService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly tg: TelegramAlertService,
  ) {}

  /** Runs on the 1st of every month at 10:00 */
  @Cron('0 10 1 * *')
  async sendMonthlyReports() {
    return runCronHandler('sendMonthlyReports', this.logger, this.tg, () =>
      this.sendMonthlyReportsImpl(),
    );
  }

  private async sendMonthlyReportsImpl() {
    this.logger.log('Monthly report job started');

    const now = new Date();
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Localize month name per user inside the loop instead of always pulling
    // it in 'ru' here (the previous behaviour leaked Russian into every
    // English digest).

    // Cursor-based pagination: pulling every active user at once OOMs once
    // we cross ~50k. 200/page lets the loop stay bounded while still being
    // a single SQL round-trip per chunk.
    const PAGE_SIZE = 200;
    let lastId: string | null = null;
    let processed = 0;
    let sent = 0;
    const dedupeWindowMs = 25 * 24 * 3_600_000; // 25 days — safely within a month

    while (true) {
      const qb = this.userRepo
        .createQueryBuilder('u')
        .where('u.isActive = true')
        .orderBy('u.id', 'ASC')
        .limit(PAGE_SIZE);
      if (lastId) qb.andWhere('u.id > :lastId', { lastId });
      const users = await qb.getMany();
      if (users.length === 0) break;
      lastId = users[users.length - 1].id;
      processed += users.length;

      for (const user of users) {
        if (!user.email) continue;
        // Respect the email opt-out flag (the old impl skipped this check
        // and was the only email type a user couldn't unsubscribe from).
        if (user.emailNotifications === false) continue;
        // Per-user idempotency — guards against multi-pod or restart
        // re-fires within the same month-end window.
        if (
          user.lastMonthlyReportSentAt &&
          Date.now() - new Date(user.lastMonthlyReportSentAt).getTime() < dedupeWindowMs
        ) {
          continue;
        }

        try {
          const subscriptions = await this.subRepo.find({
            where: { userId: user.id },
          });

          const active = subscriptions.filter(
            (s) => s.status === SubscriptionStatus.ACTIVE || s.status === SubscriptionStatus.TRIAL,
          );

          if (active.length === 0) continue;

          const withMonthly = active.map((s) => {
            const rawAmount = Number(s.amount) || 0;
            let monthly = rawAmount;
            const period = (s.billingPeriod as string)?.toUpperCase();
            if (period === 'YEARLY') monthly = monthly / 12;
            else if (period === 'WEEKLY') monthly = monthly * 4.33;
            else if (period === 'QUARTERLY') monthly = monthly / 3;
            return { ...s, monthly };
          });

          const totalMonthly = withMonthly.reduce((sum, s) => sum + (isFinite(s.monthly) ? s.monthly : 0), 0);
          const currency = withMonthly[0]?.currency ?? 'USD';
          const topSubs = [...withMonthly].sort((a, b) => b.monthly - a.monthly).slice(0, 5);
          const locale = user.locale ?? 'en';

          // Format month name in the user's locale rather than a global RU.
          let userMonthName: string;
          try {
            userMonthName = firstOfLastMonth.toLocaleString(locale, { month: 'long', year: 'numeric' });
          } catch {
            userMonthName = firstOfLastMonth.toLocaleString('en', { month: 'long', year: 'numeric' });
          }

          const html = buildMonthlyReportHtml(
            user.email.split('@')[0] || 'user',
            userMonthName,
            totalMonthly,
            currency,
            topSubs,
            active.length,
            locale,
          );

          const subject = locale.startsWith('ru')
            ? `📊 Ваш отчёт SubRadar за ${userMonthName}`
            : `📊 Your SubRadar report for ${userMonthName}`;

          await this.notifications.sendEmail(user.email, subject, html, {
            userId: user.id,
            unsubType: 'email_notifications',
          });
          await this.userRepo.update(user.id, {
            lastMonthlyReportSentAt: new Date(),
          });
          sent++;
        } catch (e) {
          this.logger.error(`Failed to send report to ${user.email}: ${e}`);
        }
      }

      if (users.length < PAGE_SIZE) break;
    }

    this.logger.log(`Monthly reports sent: ${sent}/${processed}`);
  }

}
