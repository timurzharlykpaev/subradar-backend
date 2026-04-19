import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  OutboxEvent,
  OutboxEventType,
} from './entities/outbox-event.entity';

/**
 * Transactional outbox. Writers enqueue events in the same DB transaction
 * as the billing state-machine transition that caused them — guaranteeing
 * we never lose a side effect (Amplitude, Telegram, FCM) even if the
 * downstream service is down. A cron worker drains the queue with
 * FOR UPDATE SKIP LOCKED so multiple app instances can co-exist.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly repo: Repository<OutboxEvent>,
  ) {}

  /**
   * Enqueue a new outbox event. Pass `manager` to participate in the
   * caller's transaction — critical for atomicity with state-machine
   * writes (otherwise a crash between the DB commit and enqueue leaves
   * us in an inconsistent state).
   */
  async enqueue(
    type: OutboxEventType,
    payload: Record<string, unknown>,
    manager?: EntityManager,
  ): Promise<OutboxEvent> {
    const event = this.repo.create({
      type,
      payload,
      status: 'pending',
      attempts: 0,
      lastError: null,
      nextAttemptAt: new Date(),
      processedAt: null,
    });
    return manager ? manager.save(OutboxEvent, event) : this.repo.save(event);
  }

  /**
   * Atomically claim up to `limit` pending events that are due. Flips
   * their status to `processing` so another worker (or this worker on
   * a crash-recover tick) cannot pick them up simultaneously. Uses
   * `FOR UPDATE SKIP LOCKED` to avoid serializing all workers.
   */
  async claimBatch(limit: number): Promise<OutboxEvent[]> {
    return this.repo.manager.transaction(async (m) => {
      const rows = await m.query(
        `
        UPDATE outbox_events
        SET status = 'processing'
        WHERE id IN (
          SELECT id FROM outbox_events
          WHERE status = 'pending' AND next_attempt_at <= now()
          ORDER BY next_attempt_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        `,
        [limit],
      );
      return rows as OutboxEvent[];
    });
  }

  async markDone(id: string): Promise<void> {
    await this.repo.update(id, {
      status: 'done',
      processedAt: new Date(),
      lastError: null,
    });
  }

  /**
   * Record a processing failure. If `nextAttemptAt` is provided we keep
   * the row in `pending` for retry; if `null` we've exhausted retries
   * and mark `failed` so alerting can surface it.
   */
  async markFailed(
    id: string,
    error: string,
    attempts: number,
    nextAttemptAt: Date | null,
  ): Promise<void> {
    await this.repo.update(id, {
      status: nextAttemptAt ? 'pending' : 'failed',
      attempts,
      lastError: error.slice(0, 2000),
      nextAttemptAt: nextAttemptAt ?? new Date(),
      processedAt: nextAttemptAt ? null : new Date(),
    });
  }

  async stats(): Promise<{ pending: number; failed: number; done24h: number }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [pending, failed, done24hRow] = await Promise.all([
      this.repo.count({ where: { status: 'pending' } }),
      this.repo.count({ where: { status: 'failed' } }),
      this.repo.manager.query(
        `SELECT COUNT(*)::int AS c FROM outbox_events WHERE status = 'done' AND processed_at >= $1`,
        [since],
      ),
    ]);
    return { pending, failed, done24h: Number(done24hRow[0]?.c ?? 0) };
  }
}
