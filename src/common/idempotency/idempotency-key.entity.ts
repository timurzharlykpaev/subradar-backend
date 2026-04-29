import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * Request-level idempotency (RFC 9110-style `Idempotency-Key` header).
 *
 * When a mobile client retries a POST (flaky network, app backgrounded
 * mid-request) with the same `Idempotency-Key` header, the second
 * invocation must produce the same response without re-executing the
 * side effect. We persist `(userId, endpoint, key) → cached response`
 * and replay it on duplicate requests.
 *
 * TTL is 24h — anything older expires (cleaned by a daily cron). 24h
 * matches typical mobile retry patterns (a phone returning from
 * airplane mode after a day shouldn't replay a cancellation).
 */
@Entity('idempotency_keys')
@Index('IDX_idempotency_user_endpoint_key', ['userId', 'endpoint', 'key'], {
  unique: true,
})
@Index('IDX_idempotency_created_at', ['createdAt'])
export class IdempotencyKey {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 64 })
  endpoint: string;

  @Column({ type: 'varchar', length: 128 })
  key: string;

  @Column({ type: 'integer' })
  statusCode: number;

  @Column({ type: 'jsonb', nullable: true })
  responseBody: any;

  @Column({ type: 'varchar', length: 64, nullable: true })
  requestHash: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
