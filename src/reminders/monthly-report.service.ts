import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Subscription, SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MonthlyReportService {
  private readonly logger = new Logger(MonthlyReportService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notifications: NotificationsService,
  ) {}

  /** Runs on the 1st of every month at 10:00 */
  @Cron('0 10 1 * *')
  async sendMonthlyReports() {
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
          let monthly = s.amount ?? 0;
          const period = (s.billingPeriod as string)?.toUpperCase();
          if (period === 'YEARLY') monthly = monthly / 12;
          else if (period === 'WEEKLY') monthly = monthly * 4.33;
          else if (period === 'QUARTERLY') monthly = monthly / 3;
          return { ...s, monthly };
        });

        const totalMonthly = withMonthly.reduce((sum, s) => sum + s.monthly, 0);
        const currency = withMonthly[0]?.currency ?? 'USD';
        const topSubs = [...withMonthly].sort((a, b) => b.monthly - a.monthly).slice(0, 5);

        const html = this.buildMonthlyReportHtml(
          user.email.split('@')[0] || 'пользователь',
          monthName,
          totalMonthly,
          currency,
          topSubs,
          active.length,
        );

        await this.notifications.sendEmail(
          user.email,
          `📊 Ваш отчёт SubRadar за ${monthName}`,
          html,
        );
        sent++;
      } catch (e) {
        this.logger.error(`Failed to send report to ${user.email}: ${e}`);
      }
    }

    this.logger.log(`Monthly reports sent: ${sent}/${users.length}`);
  }

  private buildMonthlyReportHtml(
    name: string,
    month: string,
    total: number,
    currency: string,
    topSubs: Array<{ name: string; monthly: number; category?: string }>,
    count: number,
  ): string {
    const fmt = (n: number) =>
      new Intl.NumberFormat('ru', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);

    const topRows = topSubs
      .map(
        (s, i) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #1e1e3a;color:#9ca3af;font-size:14px;">${i + 1}. ${s.name}</td>
          <td style="padding:10px 0;border-bottom:1px solid #1e1e3a;text-align:right;font-weight:700;color:#e5e7eb;font-size:14px;">${fmt(s.monthly)}/мес</td>
        </tr>`,
      )
      .join('');

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a16;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-flex;align-items:center;gap:10px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:16px;padding:12px 20px;">
        <span style="font-size:24px;">🎯</span>
        <span style="font-size:20px;font-weight:800;color:#fff;">SubRadar</span>
      </div>
    </div>

    <!-- Title -->
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border:1px solid rgba(139,92,246,0.2);border-radius:20px;padding:28px;margin-bottom:20px;">
      <p style="color:#9ca3af;font-size:14px;margin:0 0 8px;">Привет, ${name} 👋</p>
      <h1 style="color:#fff;font-size:24px;font-weight:800;margin:0 0 4px;">Отчёт за ${month}</h1>
      <p style="color:#6b7280;font-size:14px;margin:0;">Вот как прошёл твой месяц подписок</p>
    </div>

    <!-- Total spend -->
    <div style="background:linear-gradient(135deg,rgba(139,92,246,0.2) 0%,rgba(109,40,217,0.15) 100%);border:1px solid rgba(139,92,246,0.35);border-radius:20px;padding:28px;margin-bottom:20px;text-align:center;">
      <p style="color:#c4b5fd;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Всего потрачено в месяц</p>
      <p style="color:#fff;font-size:40px;font-weight:900;margin:0 0 4px;">${fmt(total)}</p>
      <p style="color:#9ca3af;font-size:13px;margin:0;">${count} активных подписок</p>
    </div>

    <!-- Top subscriptions -->
    <div style="background:#111128;border:1px solid #1e1e3a;border-radius:20px;padding:24px;margin-bottom:20px;">
      <h2 style="color:#e5e7eb;font-size:16px;font-weight:700;margin:0 0 16px;">💳 Топ подписки</h2>
      <table style="width:100%;border-collapse:collapse;">
        ${topRows}
      </table>
    </div>

    <!-- CTA -->
    <div style="background:#111128;border:1px solid #1e1e3a;border-radius:20px;padding:24px;margin-bottom:20px;text-align:center;">
      <p style="color:#9ca3af;font-size:14px;margin:0 0 16px;">Хочешь видеть прогноз, экономить на дублях и получать умные уведомления?</p>
      <a href="https://app.subradar.ai" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:700;font-size:15px;">
        Открыть SubRadar →
      </a>
    </div>

    <!-- Pro upsell -->
    <div style="background:linear-gradient(135deg,rgba(245,158,11,0.1) 0%,rgba(139,92,246,0.1) 100%);border:1px solid rgba(245,158,11,0.2);border-radius:20px;padding:20px;margin-bottom:20px;">
      <p style="color:#fbbf24;font-size:13px;font-weight:700;margin:0 0 8px;">⚡ SubRadar Pro</p>
      <p style="color:#d1d5db;font-size:13px;margin:0 0 12px;">Прогноз расходов · AI автодобавление · Умные напоминания · Аналитика дублей</p>
      <a href="https://app.subradar.ai/app/settings?tab=billing" style="color:#8b5cf6;font-size:13px;font-weight:700;text-decoration:none;">Попробовать Pro бесплатно →</a>
    </div>

    <!-- Footer -->
    <p style="color:#374151;font-size:12px;text-align:center;margin:0;">
      SubRadar AI · Управляй подписками умнее<br>
      <a href="https://app.subradar.ai/app/settings" style="color:#4b5563;">Отписаться от рассылки</a>
    </p>
  </div>
</body>
</html>`;
  }
}
