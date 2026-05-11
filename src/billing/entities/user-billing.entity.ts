import {
  Entity,
  Column,
  PrimaryColumn,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import type { BillingStatus } from '../../users/entities/user.entity';

/**
 * Holds the 10 billing fields owned by the BillingStateMachine.
 *
 * Single source of truth — every mutation funnels through
 * `UserBillingRepository.applyTransition`. Direct writes via TypeORM
 * `repo.update()` from outside the repository are forbidden and would
 * be rejected by the DB CHECK constraints.
 */
@Entity('user_billing')
export class UserBilling {
  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 32, default: 'free' })
  plan: string;

  @Column({
    type: 'enum',
    enum: [
      'active',
      'cancel_at_period_end',
      'billing_issue',
      'grace_pro',
      'grace_team',
      'free',
    ],
    default: 'free',
  })
  billingStatus: BillingStatus;

  @Column({ type: 'varchar', nullable: true, default: null })
  billingSource: string | null;

  @Column({ type: 'varchar', nullable: true, default: null })
  billingPeriod: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodStart: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  gracePeriodEnd: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  gracePeriodReason: 'team_expired' | 'pro_expired' | null;

  @Column({ type: 'timestamptz', nullable: true })
  billingIssueAt: Date | null;

  /**
   * Set by the state machine on RC_REFUND. Cleared on any transition
   * back into `active` (new purchase / renewal / product change) so a
   * returning customer doesn't keep seeing a stale refund banner.
   */
  @Column({ type: 'timestamptz', nullable: true })
  refundedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
