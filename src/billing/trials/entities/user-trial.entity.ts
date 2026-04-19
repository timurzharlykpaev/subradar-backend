import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../../users/entities/user.entity';

/**
 * Where a trial came from. Lets us enforce "one trial per user" while
 * still recognising RC's own intro-offer trials (so we don't double-
 * dip by also granting a backend trial to someone who just used the
 * RC intro offer).
 */
export type TrialSource = 'revenuecat_intro' | 'backend' | 'lemon_squeezy';

/** Plan the trial grants access to. */
export type TrialPlan = 'pro' | 'organization';

/**
 * Canonical per-user trial record. Unique(user_id) is enforced at the
 * DB level (see CreateUserTrials migration) — this guarantees the
 * 1-trial-per-user rule cannot be bypassed by a race.
 *
 * Replaces the legacy users.trialUsed / trialStartDate / trialEndDate
 * trio; those columns remain for one release as a rollback net and
 * will be dropped in a follow-up migration.
 */
@Entity('user_trials')
export class UserTrial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: ['revenuecat_intro', 'backend', 'lemon_squeezy'],
    enumName: 'trial_source_enum',
  })
  source: TrialSource;

  @Column({
    type: 'enum',
    enum: ['pro', 'organization'],
    enumName: 'trial_plan_enum',
  })
  plan: TrialPlan;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt: Date;

  @Index('idx_user_trials_ends_at')
  @Column({ type: 'timestamptz', name: 'ends_at' })
  endsAt: Date;

  /**
   * false only while a receipt is pending validation (RC intro offer
   * webhook raced ahead of the real purchase). True for all finalised
   * trials. Kept nullable-default at column level via default(true).
   */
  @Column({ type: 'boolean', default: true })
  consumed: boolean;

  /**
   * RC / App Store original transaction id when the trial was granted
   * through a store purchase. NULL for backend-granted trials.
   */
  @Column({ type: 'text', nullable: true, name: 'original_transaction_id' })
  originalTransactionId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
