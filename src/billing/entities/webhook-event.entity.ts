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

  /**
   * User this event was resolved to (NULL if the handler could not
   * match the event to a local user — e.g. RC INITIAL_PURCHASE that
   * arrived before appUserId was attached). FK to users with ON
   * DELETE SET NULL so account deletion does not lose the audit trail.
   */
  @Column({ type: 'uuid', nullable: true, name: 'user_id' })
  userId: string | null;

  /**
   * Provider's event name (e.g. RENEWAL, CANCELLATION,
   * subscription_updated). Enables per-type metrics without parsing
   * the id, and targeted replays when a consumer has an outage.
   */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'event_type' })
  eventType: string | null;

  /**
   * Captured exception text when the handler failed. The hourly
   * reconciliation cron uses this (via the
   * idx_webhook_events_user_error partial index) to find users whose
   * webhook never fully applied and re-sync them against the
   * provider's source of truth.
   */
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'processed_at' })
  processedAt: Date;
}
