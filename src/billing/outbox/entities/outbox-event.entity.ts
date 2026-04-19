import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Outbox row lifecycle. Writer creates as `pending`; worker picks up
 * with FOR UPDATE SKIP LOCKED and flips to `processing` before
 * handing off, then `done` or `failed` with retry scheduling.
 */
export type OutboxStatus = 'pending' | 'processing' | 'done' | 'failed';

/**
 * Known outbox event types. New types are added as additional string
 * literals here when a producer starts emitting them — kept typed so
 * consumers cannot fat-finger an event name.
 */
export type OutboxEventType =
  | 'amplitude.track'
  | 'telegram.alert'
  | 'fcm.push';

/**
 * Transactional outbox row. Writers INSERT in the same DB transaction
 * as the billing state-machine transition that caused the side effect,
 * so we never lose an event even if the side-effect service is down.
 */
@Entity('outbox_events')
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  type: OutboxEventType;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Index('idx_outbox_pending_status')
  @Column({
    type: 'enum',
    enum: ['pending', 'processing', 'done', 'failed'],
    enumName: 'outbox_status_enum',
    default: 'pending',
  })
  status: OutboxStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true, name: 'last_error' })
  lastError: string | null;

  @Column({
    type: 'timestamptz',
    name: 'next_attempt_at',
    default: () => 'now()',
  })
  nextAttemptAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'processed_at' })
  processedAt: Date | null;
}
