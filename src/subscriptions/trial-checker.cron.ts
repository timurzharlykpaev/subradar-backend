import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { pushT } from '../notifications/push-i18n';
import { TelegramAlertService } from '../common/telegram-alert.service';
import { runCronHandler } from '../common/cron/run-cron-handler';
import { UserBillingRepository } from '../billing/user-billing.repository';
import { TrialsService } from '../billing/trials/trials.service';
import { buildTrialExpiredEmail } from './emails/trial-expired-email';

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
    @Inject(forwardRef(() => TrialsService))
    private readonly trials: TrialsService,
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

        const { title, body } = pushT(user.locale).subscriptionTrialEnding({
          name: sub.name,
          daysLeft,
        });

        if (user.fcmToken) {
          await this.notifications.sendPushNotification(
            user.fcmToken,
            title,
            body,
            { subscriptionId: sub.id, type: 'trial_expiring' },
            user.id,
          );
        }

        // Email body is intentionally a thin wrapper around the localized
        // push title/body — the full per-locale email template treatment
        // lives in a separate i18n module (TODO). Keeping push localized
        // is the user-visible win; the email at least matches the user's
        // language for the headline.
        await this.notifications.sendEmail(
          user.email,
          `${title}: ${sub.name}`,
          `
            <h2>${title}</h2>
            <p>${body}</p>
            <p><strong>${sub.currency} ${sub.amount}</strong></p>
            ${sub.cancelUrl ? `<p><a href="${sub.cancelUrl}">${sub.cancelUrl}</a></p>` : ''}
            <p><a href="https://app.subradar.ai">SubRadar AI</a></p>
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

    // Source of truth for trial expiry is `user_trials.ends_at` since the
    // TrialsService migration — but new TrialsService.activate() does NOT
    // backfill the legacy `users.trialEndDate` column, so a cron reading
    // ONLY the legacy column would silently skip every trial created
    // through the new endpoint. We coalesce: prefer ut.ends_at when a
    // row exists, fall back to users.trialEndDate for the pre-migration
    // population that hasn't been re-issued through TrialsService yet.
    const expiringUsers = await this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.billing', 'b')
      .leftJoin('user_trials', 'ut', 'ut.user_id = u.id')
      .where('b.plan = :plan', { plan: 'pro' })
      .andWhere('u.trialUsed = true')
      .andWhere(
        `COALESCE(ut.ends_at, u.trialEndDate) IS NOT NULL
         AND COALESCE(ut.ends_at, u.trialEndDate) >= :tomorrow
         AND COALESCE(ut.ends_at, u.trialEndDate) < :dayAfter`,
        { tomorrow, dayAfter },
      )
      .andWhere('b.billingSource IS NULL') // not yet paid via RC/LS
      .addSelect('COALESCE(ut.ends_at, u.trialEndDate)', 'effective_ends_at')
      .getMany();

    for (const user of expiringUsers) {
      // Resolve effective end date from user_trials first, fall back to
      // legacy column. Skip silently if both are null (shouldn't happen
      // given the WHERE above, but defensive against query drift).
      const trial = await this.trials.status(user.id);
      const effectiveEnd = trial?.endsAt ?? user.trialEndDate;
      if (!effectiveEnd) continue;
      try {
        const { title, body } = pushT(user.locale).proTrialExpiring();

        if (user.fcmToken) {
          await this.notifications.sendPushNotification(
            user.fcmToken,
            title,
            body,
            { type: 'pro_trial_expiring', screen: 'paywall' },
            user.id,
          );
        }

        // Pass the user's actual locale to the email template + use it for
        // the date format too. Previous version hardcoded 'ru' which sent
        // a Russian-formatted/localized email to every user regardless of
        // their language setting.
        const emailLocale = user.locale || 'en';
        await this.notifications.sendUpcomingPaymentEmail(
          user.email,
          'SubRadar Pro',
          2.99,
          'USD',
          1,
          new Date(effectiveEnd).toLocaleDateString(emailLocale),
          'https://app.subradar.ai',
          emailLocale,
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

    // Source of truth: prefer user_trials.ends_at over the legacy
    // users.trialEndDate column. Without the COALESCE, every trial
    // activated through the new TrialsService.activate() path (which
    // writes only to user_trials) would slip past this cron forever
    // — a Pro freeloader bug.
    const expiredUsers = await this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.billing', 'b')
      .leftJoin('user_trials', 'ut', 'ut.user_id = u.id')
      .where('b.plan = :plan', { plan: 'pro' })
      .andWhere('u.trialUsed = true')
      .andWhere(
        `COALESCE(ut.ends_at, u.trialEndDate) IS NOT NULL
         AND COALESCE(ut.ends_at, u.trialEndDate) < :now`,
        { now },
      )
      .andWhere('b.billingSource IS NULL') // not paying via RC or LS
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
      const { title, body } = pushT(user.locale).proTrialExpired();

      if (user.fcmToken) {
        await this.notifications.sendPushNotification(
          user.fcmToken,
          title,
          body,
          { type: 'pro_trial_expired', screen: 'paywall' },
          user.id,
        );
      }

      const { subject, html } = buildTrialExpiredEmail(user.locale);

      await this.notifications.sendEmail(
        user.email,
        subject,
        html,
        { userId: user.id, unsubType: 'email_notifications' },
      );

      this.logger.log(`Sent trial expired notification to ${user.email}`);
    } catch (err) {
      this.logger.warn(`Failed to send trial expired notification to ${user.email}: ${err.message}`);
    }
  }
}
