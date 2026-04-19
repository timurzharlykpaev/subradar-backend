import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboxService } from './outbox.service';
import { OutboxEvent } from './entities/outbox-event.entity';
import { AmplitudeHandler } from './handlers/amplitude.handler';
import { TelegramHandler } from './handlers/telegram.handler';
import { FcmHandler } from './handlers/fcm.handler';

const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 50;
const MAX_BACKOFF_SECONDS = 60 * 60; // 1 hour cap

/**
 * Exponential backoff with a 1h ceiling. For N failed attempts the
 * delay is `2^N` seconds clamped to MAX_BACKOFF_SECONDS:
 *   1→2s, 2→4s, 3→8s, … 12→4096s (capped at 3600s).
 */
export function exponentialBackoff(attempts: number): Date {
  const seconds = Math.min(MAX_BACKOFF_SECONDS, Math.pow(2, attempts));
  return new Date(Date.now() + seconds * 1000);
}

/**
 * Cron worker that drains the outbox every 10s. Pulls a batch via
 * FOR UPDATE SKIP LOCKED (so multiple instances play nicely) and runs
 * handlers in parallel — a failure in one event can't block the others.
 *
 * Retry policy: on handler error we increment attempts and schedule the
 * next run via exponential backoff, up to MAX_ATTEMPTS (=10). After that
 * the event is moved to `failed` and operator alerting can pick it up.
 */
@Injectable()
export class OutboxWorker {
  private readonly logger = new Logger(OutboxWorker.name);

  constructor(
    private readonly outbox: OutboxService,
    private readonly amplitude: AmplitudeHandler,
    private readonly telegram: TelegramHandler,
    private readonly fcm: FcmHandler,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick(): Promise<void> {
    let batch: OutboxEvent[] = [];
    try {
      batch = await this.outbox.claimBatch(BATCH_SIZE);
    } catch (err: any) {
      // claimBatch failure is a DB-level problem (connection, migration
      // mismatch, etc.) — log loudly and bail; next tick will retry.
      this.logger.error(`Outbox claim failed: ${err?.message ?? err}`);
      return;
    }

    if (batch.length === 0) return;
    this.logger.debug(`Outbox processing batch of ${batch.length}`);
    await Promise.allSettled(batch.map((event) => this.process(event)));
  }

  private async process(event: OutboxEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'amplitude.track':
          await this.amplitude.handle(event.payload);
          break;
        case 'telegram.alert':
          await this.telegram.handle(event.payload);
          break;
        case 'fcm.push':
          await this.fcm.handle(event.payload);
          break;
        default:
          // Defensive: fail the event immediately (no retries help) if
          // someone enqueued an unknown type. Keep the switch exhaustive
          // so TypeScript flags new OutboxEventType additions.
          throw new Error(`Unknown outbox event type: ${event.type}`);
      }
      await this.outbox.markDone(event.id);
    } catch (err: any) {
      const attempts = event.attempts + 1;
      const next =
        attempts >= MAX_ATTEMPTS ? null : exponentialBackoff(attempts);
      const message = err?.message ?? String(err);
      await this.outbox.markFailed(event.id, message, attempts, next);
      if (!next) {
        this.logger.error(
          `Outbox event ${event.id} (${event.type}) moved to failed after ${attempts} attempts: ${message}`,
        );
      } else {
        this.logger.warn(
          `Outbox event ${event.id} (${event.type}) attempt ${attempts} failed: ${message}; next try at ${next.toISOString()}`,
        );
      }
    }
  }
}
