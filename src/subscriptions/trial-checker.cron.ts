import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramAlertService } from '../common/telegram-alert.service';
import { runCronHandler } from '../common/cron/run-cron-handler';
import { UserBillingRepository } from '../billing/user-billing.repository';

@Injectable()
export class TrialCheckerCron {
  private readonly logger = new Logger(TrialCheckerCron.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly tg: TelegramAlertService,
    @Inject(forwardRef(() => UserBillingRepository))
    private readonly userBilling: UserBillingRepository,
  ) {}

  // ── Subscription trial reminders (1d, 3d before end) ──────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkExpiringTrials() {
    return runCronHandler('checkExpiringTrials', this.logger, this.tg, () =>
      this.checkExpiringTrialsImpl(),
    );
  }

  private async checkExpiringTrialsImpl() {
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
            user.id,
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
          { userId: user.id, unsubType: 'email_notifications' },
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

  // ── Pro trial: warn 1 day before expiry ──────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async warnExpiringProTrials() {
    return runCronHandler('warnExpiringProTrials', this.logger, this.tg, () =>
      this.warnExpiringProTrialsImpl(),
    );
  }

  private async warnExpiringProTrialsImpl() {
    this.logger.log('Checking for expiring Pro trials (1-day warning)...');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);

    // Users on our backend trial expiring in ~1 day, not yet RC subscribers
    const expiringUsers = await this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.billing', 'b')
      .where('b.plan = :plan', { plan: 'pro' })
      .andWhere('u.trialUsed = true')
      .andWhere('u.trialEndDate IS NOT NULL')
      .andWhere('u.trialEndDate >= :tomorrow', { tomorrow })
      .andWhere('u.trialEndDate < :dayAfter', { dayAfter })
      .andWhere('b.billingSource IS NULL')  // not yet paid via RC/LS
      .getMany();

    for (const user of expiringUsers) {
      if (!user.trialEndDate) continue;
      try {
        const title = '⏰ Your SubRadar trial ends tomorrow';
        const body = 'Subscribe now to keep unlimited access to all features.';

        if (user.fcmToken) {
          await this.notifications.sendPushNotification(
            user.fcmToken,
            title,
            body,
            { type: 'pro_trial_expiring', screen: 'paywall' },
            user.id,
          );
        }

        await this.notifications.sendUpcomingPaymentEmail(
          user.email,
          'SubRadar Pro',
          2.99,
          'USD',
          1,
          new Date(user.trialEndDate).toLocaleDateString('ru-RU'),
          'https://app.subradar.ai',
          'ru',
          user.id,
        );

        this.logger.log(`Sent Pro trial expiry warning to ${user.email}`);
      } catch (err) {
        this.logger.error(`Failed to send Pro trial warning to ${user.email}: ${err.message}`);
      }
    }
  }

  // ── Pro trial: downgrade expired users + notify ──────────────────────────

  /**
   * Auto-downgrade users whose Pro trial has expired.
   * Runs daily at 00:30 UTC — offset from the top-of-hour cron rush so it
   * doesn't compete with hourly reminders for the small DB connection pool.
   * - Skip users with active RC/LS billing (they paid already)
   * - Send push + email notification about downgrade
   */
  @Cron('30 0 * * *')
  async downgradeExpiredTrials() {
    return runCronHandler('downgradeExpiredTrials', this.logger, this.tg, () =>
      this.downgradeExpiredTrialsImpl(),
    );
  }

  private async downgradeExpiredTrialsImpl() {
    this.logger.log('Checking for expired Pro trials to downgrade...');

    const now = new Date();

    const expiredUsers = await this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.billing', 'b')
      .where('b.plan = :plan', { plan: 'pro' })
      .andWhere('u.trialUsed = true')
      .andWhere('u.trialEndDate IS NOT NULL')
      .andWhere('u.trialEndDate < :now', { now })
      .andWhere('b.billingSource IS NULL')          // not paying via RC or LS
      .andWhere('u.lemonSqueezyCustomerId IS NULL') // not a LS customer
      .getMany();

    let downgraded = 0;
    for (const user of expiredUsers) {
      try {
        // billing fields go through the state machine; trialEndDate is
        // not state-machine-owned and is cleared via the user repo.
        await this.userBilling.applyTransition(
          user.id,
          { type: 'TRIAL_EXPIRED' },
          { actor: 'cron_trial' },
        );
        await this.userRepo.update(user.id, { trialEndDate: null as any });
        downgraded++;
        this.logger.log(`Downgraded user ${user.email} (${user.id}) from pro trial to free`);

        // Notify user about downgrade
        await this.sendTrialExpiredNotification(user);
      } catch (err) {
        this.logger.error(`Failed to downgrade user ${user.id}: ${err.message}`);
      }
    }

    this.logger.log(`Trial downgrade complete. Downgraded ${downgraded}/${expiredUsers.length} users.`);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async sendTrialExpiredNotification(user: User): Promise<void> {
    try {
      const title = '🔓 Your free trial has ended';
      const body = 'Subscribe to SubRadar Pro to restore unlimited access.';

      if (user.fcmToken) {
        await this.notifications.sendPushNotification(
          user.fcmToken,
          title,
          body,
          { type: 'pro_trial_expired', screen: 'paywall' },
          user.id,
        );
      }

      const html = `
<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr><td align="center" style="padding-bottom:32px;">
          <span style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">
            Sub<span style="color:#8B5CF6;">Radar</span>
          </span>
        </td></tr>
        <tr><td style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;border:1px solid rgba(139,92,246,0.3);padding:40px;">
          <p style="margin:0 0 8px;font-size:13px;color:#8B5CF6;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Пробный период завершён</p>
          <h1 style="margin:0 0 16px;font-size:22px;color:#fff;font-weight:700;">Ваш 7-дневный пробный период истёк</h1>
          <p style="margin:0 0 24px;color:#a0a0b8;font-size:15px;line-height:1.6;">
            Ваш план был переведён на <strong style="color:#fff;">Free</strong>.<br/>
            Оформите подписку <strong style="color:#8B5CF6;">SubRadar Pro</strong> чтобы вернуть неограниченный доступ.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="background:rgba(139,92,246,0.1);border-radius:12px;border:1px solid rgba(139,92,246,0.2);padding:20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color:#a0a0b8;font-size:13px;padding-bottom:8px;">Free план</td>
                  <td align="right" style="color:#fff;font-size:13px;font-weight:600;padding-bottom:8px;">3 подписки, 5 AI запросов</td>
                </tr>
                <tr>
                  <td style="color:#a0a0b8;font-size:13px;">Pro план</td>
                  <td align="right" style="color:#8B5CF6;font-size:13px;font-weight:700;">∞ подписок, 200 AI запросов</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <a href="https://app.subradar.ai/paywall" style="display:inline-block;background:linear-gradient(135deg,#8B5CF6,#6D28D9);color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:10px;">
                Оформить подписку →
              </a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding-top:24px;">
          <p style="margin:0;font-size:12px;color:#4a4a6a;">SubRadar AI · <a href="https://app.subradar.ai" style="color:#6D28D9;text-decoration:none;">app.subradar.ai</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      await this.notifications.sendEmail(
        user.email,
        '⏰ SubRadar: Пробный период завершён',
        html,
        { userId: user.id, unsubType: 'email_notifications' },
      );

      this.logger.log(`Sent trial expired notification to ${user.email}`);
    } catch (err) {
      this.logger.warn(`Failed to send trial expired notification to ${user.email}: ${err.message}`);
    }
  }
}
