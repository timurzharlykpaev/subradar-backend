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
export const CRON_EXPECTED_INTERVAL_MS: Record<string, number> = {
  // Daily crons
  resetExpiredGrace: 24 * 60 * 60 * 1000,
  cleanupAbandonedWorkspaces: 24 * 60 * 60 * 1000,
  trialChecker: 24 * 60 * 60 * 1000,
  weeklyDigest: 7 * 24 * 60 * 60 * 1000,
  monthlyReport: 31 * 24 * 60 * 60 * 1000,
  catalogRefresh: 24 * 60 * 60 * 1000,
  fxRefresh: 24 * 60 * 60 * 1000,
  analysisRefresh: 24 * 60 * 60 * 1000,
  remindersDispatch: 24 * 60 * 60 * 1000,
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
