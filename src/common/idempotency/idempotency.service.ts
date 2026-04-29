import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { IdempotencyKey } from './idempotency-key.entity';

const TTL_HOURS = 24;

export interface IdempotentResult<T> {
  cached: boolean;
  statusCode: number;
  body: T;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly repo: Repository<IdempotencyKey>,
  ) {}

  /**
   * Execute `handler` at-most-once for the (userId, endpoint, key) tuple.
   *
   * - First call: runs the handler, persists `(statusCode, body)`, returns it.
   * - Replay with the SAME request: returns the persisted response without
   *   re-running the side effect. `cached: true`.
   * - Replay with a DIFFERENT request body: throws 409 Conflict —
   *   refusing to silently treat a different request as the same
   *   operation. `requestHash` is the discriminator.
   * - Records older than TTL_HOURS are ignored — the cron cleans them up.
   */
  async run<T>(
    userId: string,
    endpoint: string,
    key: string,
    requestBody: unknown,
    handler: () => Promise<{ statusCode: number; body: T }>,
  ): Promise<IdempotentResult<T>> {
    const requestHash = this.hashRequest(requestBody);
    const existing = await this.repo.findOne({
      where: { userId, endpoint, key },
    });

    if (existing) {
      const ageHours = (Date.now() - existing.createdAt.getTime()) / 3_600_000;
      if (ageHours > TTL_HOURS) {
        // Expired — overwrite as if first call.
        await this.repo.delete({ userId, endpoint, key });
      } else {
        if (existing.requestHash && existing.requestHash !== requestHash) {
          throw new ConflictException(
            'Idempotency-Key reused with a different request body',
          );
        }
        return {
          cached: true,
          statusCode: existing.statusCode,
          body: existing.responseBody as T,
        };
      }
    }

    const result = await handler();

    // Persist the outcome. Race window: two concurrent first-time calls
    // would both insert. Unique index turns the loser into a duplicate-key
    // error — we catch it and return the row that actually won.
    try {
      await this.repo.insert({
        id: randomUUID(),
        userId,
        endpoint,
        key,
        statusCode: result.statusCode,
        responseBody: result.body as any,
        requestHash,
      });
    } catch (e: any) {
      if (e?.code === '23505') {
        const winner = await this.repo.findOne({
          where: { userId, endpoint, key },
        });
        if (winner) {
          return {
            cached: true,
            statusCode: winner.statusCode,
            body: winner.responseBody as T,
          };
        }
      }
      throw e;
    }

    return { cached: false, statusCode: result.statusCode, body: result.body };
  }

  private hashRequest(body: unknown): string {
    return createHash('sha256')
      .update(body == null ? '' : JSON.stringify(body))
      .digest('hex')
      .slice(0, 32);
  }
}
