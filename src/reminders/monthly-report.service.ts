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
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthName = firstOfLastMonth.toLocaleString('ru', { month: 'long', year: 'numeric' });

    const users = await this.userRepo.find({ where: { isActive: true } as any });
    let sent = 0;

    for (const user of users) {
      if (!user.email) continue;

      try {
        const subscriptions = await this.subRepo.find({
          where: { userId: user.id },
        });

        const active = subscriptions.filter(
          (s) => s.status === SubscriptionStatus.ACTIVE || s.status === SubscriptionStatus.TRIAL,
        );

        if (active.length === 0) continue;

        // Calculate monthly spend per subscription (normalize to monthly)
        const withMonthly = active.map((s) => {
          const rawAmount = Number(s.amount) || 0; // guard against string "NaN"
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
        const locale = (user as any).locale ?? 'ru';

        const html = buildMonthlyReportHtml(
          user.email.split('@')[0] || 'пользователь',
          monthName,
          totalMonthly,
          currency,
          topSubs,
          active.length,
          locale,
        );

        const subject = locale.startsWith('ru')
          ? `📊 Ваш отчёт SubRadar за ${monthName}`
          : `📊 Your SubRadar report for ${monthName}`;

        await this.notifications.sendEmail(user.email, subject, html);
        sent++;
      } catch (e) {
        this.logger.error(`Failed to send report to ${user.email}: ${e}`);
      }
    }

    this.logger.log(`Monthly reports sent: ${sent}/${users.length}`);
  }

}
