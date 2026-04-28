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
 * Convert a cron handler name to its env-var disable flag, e.g.
 * `sendDailyReminders` → `CRON_SEND_DAILY_REMINDERS_ENABLED`. Names are
 * camelCase, env vars are upper-snake-case + ENABLED suffix; both forms
 * are checked since some operators are likely to type `CRON_<NAME>_ENABLED`
 * as plain camelCase too.
 */
function envFlagsFor(name: string): string[] {
  const snake = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-]/g, '_')
    .toUpperCase();
  const camelUpper = name.toUpperCase();
  return Array.from(
    new Set([`CRON_${snake}_ENABLED`, `CRON_${camelUpper}_ENABLED`]),
  );
}

/**
 * Returns false only when an explicit `false` / `0` / `off` is set on any of
 * the env-var aliases. Default is on so missing env doesn't accidentally
 * silence a cron after deploy.
 */
function isCronEnabled(name: string): boolean {
  for (const key of envFlagsFor(name)) {
    const raw = process.env[key];
    if (raw === undefined) continue;
    const v = raw.trim().toLowerCase();
    if (v === 'false' || v === '0' || v === 'off' || v === 'disabled') {
      return false;
    }
  }
  return true;
}

/**
 * Wraps a cron handler so that:
 *   1. Per-cron kill switch via `CRON_<NAME>_ENABLED=false` env var. The
 *      handler short-circuits before doing any work — useful for taming a
 *      misbehaving job in prod without redeploying code.
 *   2. Unexpected exceptions are caught (no unhandled rejections bubbling up
 *      to the scheduler, which swallows them silently in older Nest builds).
 *   3. A Telegram alert is sent with deduplication per cron name so bursts of
 *      failures don't spam the channel.
 *   4. Duration is logged for observability.
 *   5. On success, a heartbeat timestamp is written to Redis so the monitor
 *      cron can detect missed runs (CRON_MISSED alerts).
 *
 * Usage:
 *   @Cron('0 9 * * 1')
 *   async weeklyDigest() {
 *     return runCronHandler('weeklyDigest', this.logger, this.tg, async () => {
 *       // ... body ...
 *     });
 *   }
 *
 * Disable in env:
 *   CRON_WEEKLY_DIGEST_ENABLED=false
 */
export async function runCronHandler<T>(
  name: string,
  logger: Logger,
  tg: TelegramAlertService | null | undefined,
  handler: () => Promise<T>,
): Promise<T | undefined> {
  if (!isCronEnabled(name)) {
    logger.warn(`[cron:${name}] disabled via env flag — skipping`);
    return undefined;
  }
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
