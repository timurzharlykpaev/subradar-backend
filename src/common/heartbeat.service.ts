import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.module';
import { TelegramAlertService } from './telegram-alert.service';

const KEY_PREFIX = 'cron:heartbeat:';
const ALL_NAMES_SET = 'cron:heartbeat:names';

/**
 * Expected interval per cron (ms). If we haven't seen a successful heartbeat
 * for a job within `expectedIntervalMs + GRACE_MS`, alert.
 *
 * Keep in sync with the `@Cron(...)` schedules. The monitor cron (below) runs
 * hourly; be conservative with the expectations (>= actual schedule).
 */
// Names below MUST match the first arg passed to `runCronHandler(name,...)`
// for each @Cron handler. The previous version of this map used
// human-friendly aliases (`trialChecker`, `monthlyReport`, …) that didn't
// match anything actually emitted by `recordSuccess()`, so the missed-cron
// alert never fired. Keep this list in sync with the @Cron decorators.
export const CRON_EXPECTED_INTERVAL_MS: Record<string, number> = {
  // Daily reminders / billing
  sendDailyReminders: 24 * 60 * 60 * 1000,
  sendTrialExpiryReminders: 24 * 60 * 60 * 1000,
  sendProExpirationReminders: 24 * 60 * 60 * 1000,
  sendWinBackPush: 24 * 60 * 60 * 1000,
  expireTrials: 60 * 60 * 1000,
  resetExpiredGrace: 24 * 60 * 60 * 1000,
  cleanupAbandonedWorkspaces: 24 * 60 * 60 * 1000,
  // Weekly
  sendWeeklyPushDigest: 7 * 24 * 60 * 60 * 1000,
  weeklyAnalysisTrigger: 7 * 24 * 60 * 60 * 1000,
  weeklyDigestSend: 7 * 24 * 60 * 60 * 1000,
  catalogRefreshTopServices: 7 * 24 * 60 * 60 * 1000,
  analysisCleanup: 7 * 24 * 60 * 60 * 1000,
  // Monthly
  sendMonthlyReports: 31 * 24 * 60 * 60 * 1000,
  // Daily infra
  fxRefreshDaily: 24 * 60 * 60 * 1000,
  // Hourly
  reconciliation: 60 * 60 * 1000,
  heartbeatMonitor: 60 * 60 * 1000,
};

const GRACE_MS = 60 * 60 * 1000; // 1 hour grace

@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly tg: TelegramAlertService,
  ) {}

  /** Record a successful cron run. Fire-and-forget — never throws. */
  async recordSuccess(name: string): Promise<void> {
    const now = Date.now();
    try {
      await this.redis.set(`${KEY_PREFIX}${name}`, String(now));
      await this.redis.sadd(ALL_NAMES_SET, name);
    } catch (e: any) {
      this.logger.warn(`heartbeat set failed for ${name}: ${e?.message ?? e}`);
    }
  }

  /**
   * Check all known heartbeats and alert on any that are stale beyond
   * `expected + GRACE_MS`. Uses Telegram dedup so we don't spam.
   */
  async checkMissed(): Promise<void> {
    let names: string[] = [];
    try {
      names = (await this.redis.smembers(ALL_NAMES_SET)) ?? [];
    } catch (e: any) {
      this.logger.warn(`heartbeat check failed: ${e?.message ?? e}`);
      return;
    }

    // Include any cron we expect even if heartbeat was never recorded yet.
    const allNames = new Set<string>([...names, ...Object.keys(CRON_EXPECTED_INTERVAL_MS)]);
    const now = Date.now();

    for (const name of allNames) {
      const expected = CRON_EXPECTED_INTERVAL_MS[name];
      if (!expected) continue; // skip unknown crons (no SLA defined)

      let lastStr: string | null = null;
      try {
        lastStr = await this.redis.get(`${KEY_PREFIX}${name}`);
      } catch {
        continue;
      }

      const last = lastStr ? Number(lastStr) : 0;
      const age = now - last;
      const threshold = expected + GRACE_MS;

      if (age > threshold) {
        const ageStr = last === 0 ? 'never' : `${Math.round(age / 60000)}m ago`;
        await this.tg
          .send(
            `<b>CRON_MISSED</b>: <code>${name}</code>\n` +
              `Last heartbeat: ${ageStr}\n` +
              `Expected interval: ${Math.round(expected / 60000)}m`,
            `cron-missed:${name}`,
          )
          .catch(() => {});
      }
    }
  }
}
