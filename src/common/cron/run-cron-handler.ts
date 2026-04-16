import { Logger } from '@nestjs/common';
import { TelegramAlertService } from '../telegram-alert.service';
import { HeartbeatService } from '../heartbeat.service';

// Lazy module-level holder — set once when HeartbeatModule initializes.
// Keeping this as a singleton avoids changing the signature of every
// existing runCronHandler call site.
let heartbeat: HeartbeatService | null = null;
export function setHeartbeatService(h: HeartbeatService | null): void {
  heartbeat = h;
}

/**
 * Wraps a cron handler so that:
 *   1. Unexpected exceptions are caught (no unhandled rejections bubbling up
 *      to the scheduler, which swallows them silently in older Nest builds).
 *   2. A Telegram alert is sent with deduplication per cron name so bursts of
 *      failures don't spam the channel.
 *   3. Duration is logged for observability.
 *   4. On success, a heartbeat timestamp is written to Redis so the monitor
 *      cron can detect missed runs (CRON_MISSED alerts).
 *
 * Usage:
 *   @Cron('0 9 * * 1')
 *   async weeklyDigest() {
 *     return runCronHandler('weeklyDigest', this.logger, this.tg, async () => {
 *       // ... body ...
 *     });
 *   }
 */
export async function runCronHandler<T>(
  name: string,
  logger: Logger,
  tg: TelegramAlertService | null | undefined,
  handler: () => Promise<T>,
): Promise<T | undefined> {
  const startedAt = Date.now();
  try {
    const result = await handler();
    const durationMs = Date.now() - startedAt;
    logger.log(`[cron:${name}] completed in ${durationMs}ms`);
    // Fire-and-forget heartbeat. Never let Redis hiccups fail the cron.
    if (heartbeat) {
      heartbeat.recordSuccess(name).catch(() => {});
    }
    return result;
  } catch (err: any) {
    const durationMs = Date.now() - startedAt;
    const msg = err?.message || String(err);
    logger.error(
      `[cron:${name}] failed after ${durationMs}ms: ${msg}`,
      err?.stack,
    );
    if (tg) {
      await tg.send(
        `<b>[cron] ${name}</b> failed after ${durationMs}ms\n<pre>${msg.slice(0, 800)}</pre>`,
        `cron:${name}`,
      );
    }
    return undefined;
  }
}
