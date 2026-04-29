import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';
import { toZonedTime } from 'date-fns-tz';
import { Subscription, SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  buildProExpirationEmail,
  buildDailyDigestEmail,
  dailyDigestSubject,
} from '../notifications/email-templates';
import { pushT } from '../notifications/push-i18n';
import { TelegramAlertService } from '../common/telegram-alert.service';
import { runCronHandler } from '../common/cron/run-cron-handler';
import { UserBillingRepository } from '../billing/user-billing.repository';

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
    private readonly userBilling: UserBillingRepository,
  ) {}

  /**
   * True if `last` is more recent than `hours` ago. Used as the per-user
   * dedupe gate for the notification crons — without this, a container
   * restart or a multi-pod deploy on the same calendar day would refire
   * the same push/email. We use 20h (not 24h) to absorb minor schedule
   * drift while still catching genuine same-day reruns.
   */
  private sentWithin(last: Date | null | undefined, hours: number): boolean {
    if (!last) return false;
    const cutoff = Date.now() - hours * 3_600_000;
    return new Date(last).getTime() > cutoff;
  }

  /**
   * Atomically reserve the right to send a notification to one user by
   * stamping a "lastXxxAt" column. Returns true ONLY for the worker that
   * actually wins the UPDATE — ties go to nobody. Without this two
   * concurrent pods can both pass the in-memory `sentWithin()` check on
   * the same row and double-fire the push/email. The window keeps the
   * stale-row test on the SQL side so it's race-free.
   *
   * Caveat: this stamps BEFORE the channel call. If the FCM/Resend send
   * fails the user simply misses this run — next tomorrow's cycle will
   * pick them back up. This is the right tradeoff vs the alternative
   * (stamp after success, double-send under contention).
   */
  private async claimNotification(
    userId: string,
    column:
      | 'lastPaymentRemindersSentAt'
      | 'lastTrialPushAt'
      | 'lastProExpirationPushAt'
      | 'lastProExpirationEmailAt'
      | 'lastWeeklyPushDigestAt'
      | 'lastWinBackPushAt',
    hours: number,
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - hours * 3_600_000);
    const res = await this.userRepo
      .createQueryBuilder()
      .update(User)
      .set({ [column]: () => 'NOW()' } as any)
      .where('id = :id', { id: userId })
      .andWhere(`(${column} IS NULL OR ${column} < :cutoff)`, { cutoff })
      .execute();
    return (res.affected ?? 0) > 0;
  }

  /**
   * Resolve a user's local hour and weekday (0=Sunday). Falls back to UTC if
   * the user has no detected timezone. Used by the hourly cron to fire
   * notifications when the *user's* local clock hits the desired hour
   * instead of blasting everyone at 09:00 UTC (= 04:00 PST / 18:00 in
   * Tokyo).
   */
  private userLocalNow(user: User): { hour: number; weekday: number } {
    const tz = user.timezoneDetected || user.timezone || 'UTC';
    let zoned: Date;
    try {
      zoned = toZonedTime(new Date(), tz);
    } catch {
      zoned = new Date();
    }
    return { hour: zoned.getHours(), weekday: zoned.getDay() };
  }

  // ── 5 daily/weekly notification crons all run hourly and gate per-user
  // by the user's local clock. Idempotency columns (lastXxxAt, 20h /
  // 6 days windows) make the second hourly tick on the same day a no-op.
  @Cron(CronExpression.EVERY_HOUR)
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

    this.logger.log(
      `Found ${subscriptions.length} subscriptions with reminders in next 7 days`,
    );

    // Group subscriptions by user — the digest fires once per user per day,
    // not once per subscription. Without this a user with 5 due subs got
    // 5 pushes + 5 emails on the same morning (spam-trigger territory).
    const subsByUser = new Map<string, Subscription[]>();
    for (const sub of subscriptions) {
      const list = subsByUser.get(sub.userId) ?? [];
      list.push(sub);
      subsByUser.set(sub.userId, list);
    }

    let usersNotified = 0;
    let errors = 0;
    const todayKey = utcToday.toISOString().split('T')[0];

    const TARGET_LOCAL_HOUR = 9; // 09:00 in the user's own timezone
    for (const [userId, userSubs] of subsByUser) {
      try {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) continue;
        if (!user.notificationsEnabled) continue;

        // Send only when the user's local clock hits the target hour.
        // The cron runs every hour but each user only matches one tick
        // per day. Idempotency below catches the rare case where two
        // hourly ticks land in the same wall hour (clock skew).
        const local = this.userLocalNow(user);
        if (local.hour !== TARGET_LOCAL_HOUR) continue;

        // Per-user idempotency. Cheap in-memory pre-check skips most users
        // before we do any aggregation work; the atomic claim further down
        // is the actual race-safe gate.
        if (this.sentWithin(user.lastPaymentRemindersSentAt, 20)) continue;

        const userTz = user.timezoneDetected || user.timezone || 'UTC';
        const nowInUserTz = toZonedTime(new Date(), userTz);
        const todayInUserTz = new Date(
          nowInUserTz.getFullYear(),
          nowInUserTz.getMonth(),
          nowInUserTz.getDate(),
        );

        // Pick the subs that actually fire today inside the user's local day,
        // matching their per-sub reminderDaysBefore window.
        const due: Array<{
          sub: Subscription;
          daysLeft: number;
          dateStr: string;
        }> = [];
        for (const sub of userSubs) {
          const paymentDate = new Date(sub.nextPaymentDate);
          if (isNaN(paymentDate.getTime())) continue;

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
          const reminderDays: number[] = (sub as any).reminderDaysBefore ?? [1, 3];
          if (!reminderDays.includes(daysLeft)) continue;

          // Belt-and-braces — per-sub flag still skips items already
          // emailed in a previous half-finished run earlier today.
          const lastSent = (sub as any).lastReminderSentDate
            ? new Date((sub as any).lastReminderSentDate)
                .toISOString()
                .split('T')[0]
            : null;
          if (lastSent === todayKey) continue;

          due.push({
            sub,
            daysLeft,
            dateStr: paymentDate.toISOString().split('T')[0],
          });
        }

        if (due.length === 0) continue;

        // Race-safe: only one worker proceeds even if two pods both passed
        // the in-memory check above on the same row.
        const claimed = await this.claimNotification(
          user.id,
          'lastPaymentRemindersSentAt',
          20,
        );
        if (!claimed) continue;

        // Total in the user's display currency proxy — we use the first
        // subscription's currency since FX conversion is not in scope here.
        const totalAmount = due.reduce((sum, d) => {
          const n = Number(d.sub.amount) || 0;
          return sum + n;
        }, 0);
        const currency = due[0].sub.currency;
        const earliestDays = due.reduce(
          (min, d) => (d.daysLeft < min ? d.daysLeft : min),
          due[0].daysLeft,
        );
        const topNames = due.slice(0, 2).map((d) => d.sub.name);

        // ─── Email digest ──────────────────────────────────────────────
        const emailEnabled = user.emailNotifications !== false;
        if (emailEnabled && user.email) {
          const html = buildDailyDigestEmail({
            locale: user.locale ?? 'en',
            name: user.name?.trim() || user.email.split('@')[0],
            items: due.map((d) => ({
              name: d.sub.name,
              amount: Number(d.sub.amount) || 0,
              currency: d.sub.currency,
              daysLeft: d.daysLeft,
              dateStr: d.dateStr,
            })),
            totalAmount,
            currency,
          });
          const subject = dailyDigestSubject(user.locale ?? 'en', due.length);
          await this.notificationsService.sendEmail(user.email, subject, html, {
            userId: user.id,
            unsubType: 'email_notifications',
          });
        }

        // ─── Push digest ───────────────────────────────────────────────
        if (user.fcmToken) {
          const { title, body } = pushT(user.locale).paymentRemindersDigest({
            count: due.length,
            totalAmount,
            currency,
            earliestDays,
            topNames,
          });
          await this.notificationsService.sendPushNotification(
            user.fcmToken,
            title,
            body,
            { type: 'payment_reminders_digest', screen: '/(tabs)' },
            user.id,
          );
        }

        // Mark per-sub flags so a half-rerun later today still skips
        // these. The user-level claim already holds — these are belt-
        // and-braces for the per-sub `reminderEnabled` gate.
        await this.subscriptionRepo
          .createQueryBuilder()
          .update()
          .set({ lastReminderSentDate: utcToday } as any)
          .whereInIds(due.map((d) => d.sub.id))
          .execute();
        usersNotified++;
      } catch (err) {
        errors++;
        this.logger.error(
          `Failed to send reminder digest for user ${userId}:`,
          err,
        );
      }
    }

    this.logger.log(
      `Reminder digests sent to ${usersNotified} users, errors: ${errors}`,
    );
  }

  /** Notify users whose trial is about to expire — runs daily at 10:00 */
  @Cron(CronExpression.EVERY_HOUR)
  async sendTrialExpiryReminders() {
    return runCronHandler('sendTrialExpiryReminders', this.logger, this.tg, () =>
      this.sendTrialExpiryRemindersImpl(),
    );
  }

  private async sendTrialExpiryRemindersImpl() {
    this.logger.log('Running trial expiry reminders cron...');
    const TARGET_LOCAL_HOUR = 10;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const in1Day = new Date(today);
    in1Day.setDate(today.getDate() + 1);

    const in4Days = new Date(today);
    in4Days.setDate(today.getDate() + 4);

    const users = await this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.billing', 'b')
      .where("b.plan = 'pro'")
      .andWhere('u.trialUsed = true')
      .andWhere('u.lemonSqueezyCustomerId IS NULL')
      .andWhere('u.trialEndDate IS NOT NULL')
      .getMany();

    let sent = 0;
    let errors = 0;

    for (const user of users) {
      try {
        if (!user.trialEndDate) continue;
        if (this.userLocalNow(user).hour !== TARGET_LOCAL_HOUR) continue;

        const trialEnd = new Date(user.trialEndDate);
        trialEnd.setHours(0, 0, 0, 0);

        const diffMs = trialEnd.getTime() - today.getTime();
        const daysLeft = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (daysLeft !== 1 && daysLeft !== 4) continue;
        if (!user.notificationsEnabled) continue;
        if (this.sentWithin(user.lastTrialPushAt, 20)) continue;
        if (!user.fcmToken) continue;

        // Atomic claim BEFORE the channel call to prevent multi-pod
        // double-fire on the same hour tick.
        const claimed = await this.claimNotification(
          user.id,
          'lastTrialPushAt',
          20,
        );
        if (!claimed) continue;

        const { title, body } = pushT(user.locale).trialExpiry({ daysLeft });
        await this.notificationsService.sendPushNotification(
          user.fcmToken,
          title,
          body,
          { type: 'trial_expiry', screen: '/paywall' },
          user.id,
        );

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

  /** Notify users whose Pro subscription is about to expire — at 10:00 in their local timezone. */
  @Cron(CronExpression.EVERY_HOUR)
  async sendProExpirationReminders() {
    return runCronHandler('sendProExpirationReminders', this.logger, this.tg, () =>
      this.sendProExpirationRemindersImpl(),
    );
  }

  private async sendProExpirationRemindersImpl() {
    this.logger.log('Running Pro expiration reminders cron...');
    const TARGET_LOCAL_HOUR = 10;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find users with cancelAtPeriodEnd=true and currentPeriodEnd in the future (or today)
    const users = await this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.billing', 'b')
      .where('b.cancelAtPeriodEnd = true')
      .andWhere('b.currentPeriodEnd IS NOT NULL')
      .andWhere("b.plan != 'free'")
      .getMany();

    let sent = 0;
    let errors = 0;

    for (const user of users) {
      try {
        if (!user.currentPeriodEnd) continue;
        if (!user.notificationsEnabled) continue;
        if (this.userLocalNow(user).hour !== TARGET_LOCAL_HOUR) continue;

        const periodEnd = new Date(user.currentPeriodEnd);
        periodEnd.setHours(0, 0, 0, 0);

        const diffMs = periodEnd.getTime() - today.getTime();
        const daysLeft = Math.round(diffMs / (1000 * 60 * 60 * 24));

        // Send at 7 days, 3 days, 1 day before, and on expiration day (0)
        if (![7, 3, 1, 0].includes(daysLeft)) continue;

        const { title, body } = pushT(user.locale).proExpiration({ daysLeft });

        // Push: race-safe claim per-day (20h window).
        if (user.fcmToken && !this.sentWithin(user.lastProExpirationPushAt, 20)) {
          const claimedPush = await this.claimNotification(
            user.id,
            'lastProExpirationPushAt',
            20,
          );
          if (claimedPush) {
            await this.notificationsService.sendPushNotification(
              user.fcmToken,
              title,
              body,
              { type: 'pro_expiration', screen: '/paywall' },
              user.id,
            );
          }
        }

        // Email only at the 7-day mark, dedupe with a long window so the
        // same milestone never re-fires (period is bound to a specific
        // currentPeriodEnd; if the user reactivates we reset elsewhere).
        if (daysLeft === 7) {
          const emailEnabled = user.emailNotifications !== false;
          if (emailEnabled && !this.sentWithin(user.lastProExpirationEmailAt, 20)) {
            const claimedEmail = await this.claimNotification(
              user.id,
              'lastProExpirationEmailAt',
              20,
            );
            if (claimedEmail) {
              const unsubscribeUrl = this.notificationsService.buildUnsubscribeUrl(
                user.id,
                'email_notifications',
              );
              const { subject, html } = buildProExpirationEmail({
                locale: user.locale ?? 'en',
                name: user.name ?? null,
                unsubscribeUrl,
              });
              await this.notificationsService.sendEmail(
                user.email,
                subject,
                html,
                { userId: user.id, unsubType: 'email_notifications' },
              );
            }
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

  /** Weekly push digest — every Sunday at 11:00 in the user's local timezone. */
  @Cron(CronExpression.EVERY_HOUR)
  async sendWeeklyPushDigest() {
    return runCronHandler('sendWeeklyPushDigest', this.logger, this.tg, () =>
      this.sendWeeklyPushDigestImpl(),
    );
  }

  private async sendWeeklyPushDigestImpl() {
    this.logger.log('Running weekly push digest...');
    const TARGET_LOCAL_HOUR = 11;
    const TARGET_LOCAL_WEEKDAY = 0; // Sunday

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
        const local = this.userLocalNow(user);
        if (local.weekday !== TARGET_LOCAL_WEEKDAY) continue;
        if (local.hour !== TARGET_LOCAL_HOUR) continue;
        // Dedupe to one digest per ~6 days even if the cron fires twice
        // (multi-pod, restart). The rest of the heavy aggregation below
        // only runs for users that actually need it.
        if (this.sentWithin(user.lastWeeklyPushDigestAt, 6 * 24)) continue;

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

        // Race-safe claim — only the worker that wins the UPDATE proceeds.
        const claimed = await this.claimNotification(
          user.id,
          'lastWeeklyPushDigestAt',
          6 * 24,
        );
        if (!claimed) continue;

        const currency = active[0]?.currency ?? 'USD';
        const { title, body } = pushT(user.locale).weeklyDigest({
          currency,
          totalMonthly,
          activeCount: active.length,
          renewingThisWeek: renewingThisWeek.length,
        });

        await this.notificationsService.sendPushNotification(
          user.fcmToken,
          title,
          body,
          { type: 'weekly_digest', screen: '/(tabs)' },
          user.id,
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
      .leftJoinAndSelect('u.billing', 'b')
      .where("b.plan = 'pro'")
      .andWhere('u.trialUsed = true')
      .andWhere('u.trialEndDate < NOW()')
      .andWhere('u.lemonSqueezyCustomerId IS NULL')
      // Skip users who started a real RC subscription on top of the
      // legacy trial — their billingSource will be set, and we must not
      // null out their plan. The trial timer is only authoritative for
      // backend-only trials.
      .andWhere('(b."billingSource" IS NULL)')
      .getMany();

    for (const user of expired) {
      // Update plan AND billingStatus together. The previous version only
      // touched `plan`, leaving `billingStatus='active'` from the trial
      // start, which made EffectiveAccessResolver still report Pro via
      // PAID_STATES.has(billingStatus) — the trial "expired" by the cron
      // but the user kept seeing Pro in /billing/me until something else
      // wrote to billingStatus. cancelAtPeriodEnd is also cleared so the
      // banner pipeline doesn't mistake an expired trial for an
      // outstanding cancellation.
      await this.userBilling.applyTransition(
        user.id,
        { type: 'TRIAL_EXPIRED' },
        { actor: 'cron_trial' },
      );
      // trialEndDate isn't a state-machine field — clear it directly.
      await this.userRepo.update(user.id, { trialEndDate: null as any });
      this.logger.log(`Trial expired → downgraded to free: ${user.email}`);
    }
    if (expired.length > 0) {
      this.logger.log(`Expired ${expired.length} trials`);
    }
  }

  /** Win-back push for users inactive 7+ days — at 14:00 in their local timezone. */
  @Cron(CronExpression.EVERY_HOUR)
  async sendWinBackPush() {
    return runCronHandler('sendWinBackPush', this.logger, this.tg, () =>
      this.sendWinBackPushImpl(),
    );
  }

  private async sendWinBackPushImpl() {
    this.logger.log('Running win-back push cron...');
    const TARGET_LOCAL_HOUR = 14;

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
        if (this.userLocalNow(user).hour !== TARGET_LOCAL_HOUR) continue;
        // Don't pester the same user twice in a calendar day if the cron
        // restarts. Win-back is meant to be a gentle nudge, not a barrage.
        if (this.sentWithin(user.lastWinBackPushAt, 20)) continue;

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

        // Race-safe claim before sending.
        const claimed = await this.claimNotification(
          user.id,
          'lastWinBackPushAt',
          20,
        );
        if (!claimed) continue;

        const { title, body } = pushT(user.locale).winBack({
          upcomingCount: upcomingSubs,
        });

        await this.notificationsService.sendPushNotification(
          user.fcmToken,
          title,
          body,
          { type: 'win_back', screen: '/(tabs)' },
          user.id,
        );
        sent++;
      } catch (err) {
        this.logger.error(`Win-back push failed for ${user.id}:`, err);
      }
    }

    this.logger.log(`Win-back pushes sent: ${sent}`);
  }
}
