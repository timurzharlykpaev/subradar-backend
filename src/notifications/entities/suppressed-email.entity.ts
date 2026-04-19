import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

/**
 * Email suppression list — addresses that must NOT receive any further mail.
 *
 * Populated from Resend webhook events (`bounced`, `complained`) and from
 * one-click unsubscribe handlers. Checked by NotificationsService.sendEmail()
 * before every send so we don't keep hitting a spam trap or a hard-bouncing
 * inbox — the fastest way to ruin sender reputation.
 *
 * Stored by email (lowercase). One row per address; reason updated on duplicates.
 */
@Entity('suppressed_emails')
export class SuppressedEmail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Lowercased email address — uniqueness is enforced at DB level. */
  @Column({ type: 'varchar', length: 320, unique: true })
  @Index('IDX_suppressed_emails_email')
  email: string;

  /** Why this address was suppressed. */
  @Column({ type: 'varchar', length: 32 })
  reason: 'hard_bounce' | 'soft_bounce' | 'complaint' | 'unsubscribe' | 'manual';

  /** Optional context (Resend event id, webhook payload, manual reason). */
  @Column({ type: 'text', nullable: true })
  context: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
