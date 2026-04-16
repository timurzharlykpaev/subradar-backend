import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.module';
import { TelegramAlertService } from './telegram-alert.service';

/**
 * Every minute, runs the same health indicators as `/health` (DB + Redis).
 * If the check fails 3 minutes in a row, fires a Telegram alert. Resets once
 * a healthy check is observed.
 *
 * This runs in-process — it will not detect the server being completely down,
 * but it will detect dependency outages (DB/Redis partitions, connection pool
 * exhaustion, etc.) earlier than user reports.
 */
@Injectable()
export class HealthWatchCron {
  private readonly logger = new Logger(HealthWatchCron.name);
  private consecutiveFailures = 0;
  private readonly THRESHOLD = 3;

  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly tg: TelegramAlertService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async watch() {
    let ok = true;
    let reason = '';
    try {
      await this.health.check([
        () => this.db.pingCheck('database', { timeout: 2000 }),
        async () => {
          const pong = await this.redis.ping();
          if (pong !== 'PONG') throw new Error(`unexpected ping: ${pong}`);
          return { redis: { status: 'up' } };
        },
      ]);
    } catch (e: any) {
      ok = false;
      reason = e?.message || String(e);
    }

    if (ok) {
      if (this.consecutiveFailures >= this.THRESHOLD) {
        // Recovery — notify so on-call knows it cleared.
        await this.tg
          .send(`✅ <b>Health recovered</b> after ${this.consecutiveFailures} failed checks`, 'health-recovered')
          .catch(() => {});
      }
      this.consecutiveFailures = 0;
      return;
    }

    this.consecutiveFailures += 1;
    this.logger.warn(`[health-watch] failure #${this.consecutiveFailures}: ${reason}`);

    if (this.consecutiveFailures === this.THRESHOLD) {
      // First alert at threshold; dedup key ensures no retriggering until recovery.
      await this.tg
        .send(
          `🔴 <b>Health check failing</b> for ${this.THRESHOLD} consecutive minutes\n<pre>${reason.slice(0, 600)}</pre>`,
          'health-failing',
        )
        .catch(() => {});
    }
  }
}
