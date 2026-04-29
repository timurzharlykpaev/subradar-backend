import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Captures every billing transition that the state machine refused
 * (`InvalidTransitionError`) so an operator can inspect, fix, and
 * optionally replay it. Replaces the previous "log + audit row" pattern
 * which made aberrations findable but passive — now they're a queryable
 * queue with an explicit `resolved` flag and (eventually) a manual replay
 * UI.
 *
 * Inserted by `UserBillingRepository.applyTransition` whenever it
 * returns `{ applied: false, reason: 'invalid_transition' }`. A
 * Telegram alert fires on insert so the on-call sees it the moment it
 * happens.
 */
@Entity('billing_dead_letter')
@Index('IDX_billing_dlq_user_created', ['userId', 'createdAt'])
@Index('IDX_billing_dlq_unresolved', ['resolved', 'createdAt'])
export class BillingDeadLetter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 64 })
  fromState: string;

  @Column({ type: 'varchar', length: 64 })
  eventType: string;

  @Column({ type: 'varchar', length: 64 })
  actor: string;

  @Column({ type: 'jsonb', nullable: true })
  eventPayload: any;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /**
   * Operator-facing flag. Set to `true` after the row has been
   * investigated / replayed / dismissed. Index `IDX_billing_dlq_unresolved`
   * makes the "is the queue empty?" query an instant scan.
   */
  @Column({ type: 'boolean', default: false })
  resolved: boolean;

  @Column({ type: 'text', nullable: true })
  resolutionNotes: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
