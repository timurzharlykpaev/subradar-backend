import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

/**
 * Idempotency record for billing webhooks (RevenueCat, Lemon Squeezy, etc).
 *
 * Before processing a webhook we attempt to INSERT a row with a
 * `(provider, eventId)` unique pair. A duplicate-key error means the event
 * has already been processed — we then short-circuit and return 200 so
 * providers stop retrying.
 */
@Entity('webhook_events')
@Unique('UQ_webhook_events_provider_event_id', ['provider', 'eventId'])
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 32 })
  provider: string; // 'revenuecat' | 'lemon_squeezy'

  @Column({ type: 'varchar', length: 191, name: 'event_id' })
  eventId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'processed_at' })
  processedAt: Date;
}
