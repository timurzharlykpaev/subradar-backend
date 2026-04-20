import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Subscription } from '../../subscriptions/entities/subscription.entity';
import { PaymentCard } from '../../payment-cards/entities/payment-card.entity';

export enum AuthProvider {
  LOCAL = 'local',
  GOOGLE = 'google',
  APPLE = 'apple',
}

/**
 * Canonical billing state for a user, written by the BillingStateMachine.
 * Replaces the ad-hoc combination of `plan + cancelAtPeriodEnd +
 * gracePeriodEnd + billingIssueAt` flags for access-control decisions.
 */
export type BillingStatus =
  | 'active'
  | 'cancel_at_period_end'
  | 'billing_issue'
  | 'grace_pro'
  | 'grace_team'
  | 'free';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true, select: false })
  @Exclude({ toPlainOnly: true })
  password: string;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ type: 'enum', enum: AuthProvider, default: AuthProvider.LOCAL })
  provider: AuthProvider;

  @Column({ nullable: true })
  providerId: string;

  @Column({ nullable: true })
  fcmToken: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  @Exclude({ toPlainOnly: true })
  refreshToken: string;

  @Column({ nullable: true })
  @Exclude({ toPlainOnly: true })
  magicLinkToken: string;

  @Column({ nullable: true })
  @Exclude({ toPlainOnly: true })
  magicLinkExpiry: Date;

  @Column({ nullable: true })
  @Exclude({ toPlainOnly: true })
  lemonSqueezyCustomerId: string;

  @Column({ default: 'free' })
  plan: string;

  @Column({ type: 'varchar', nullable: true, default: null })
  billingPeriod: string | null;

  @Column({ default: false })
  trialUsed: boolean;

  @Column({ nullable: true, type: 'timestamp' })
  trialStartDate: Date | null;

  @Column({ nullable: true, type: 'timestamp' })
  trialEndDate: Date | null;

  @Column({ default: 0 })
  aiRequestsUsed: number;

  @Column({ nullable: true })
  aiRequestsMonth: string;

  @Column({ type: 'varchar', nullable: true, default: null })
  proInviteeEmail!: string;

  @Column({ nullable: true })
  timezone: string;

  @Column({ nullable: true })
  locale: string;

  @Column({ nullable: true })
  country: string;

  @Column({ nullable: true, default: 'USD' })
  defaultCurrency: string;

  @Column({ type: 'varchar', length: 2, default: 'US' })
  region: string;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  displayCurrency: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  timezoneDetected: string | null;

  @Column({ nullable: true })
  dateFormat: string;

  @Column({ default: false })
  onboardingCompleted: boolean;

  @Column({ default: true })
  notificationsEnabled: boolean;

  @Column({ nullable: true, default: 3 })
  reminderDaysBefore: number;

  @Column({ nullable: true, default: true })
  emailNotifications: boolean;

  @Column({ type: 'boolean', default: true })
  weeklyDigestEnabled: boolean;

  @Column({ type: 'timestamp', nullable: true, default: null })
  weeklyDigestSentAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  @Exclude({ toPlainOnly: true })
  refreshTokenIssuedAt: Date | null;

  @OneToMany(() => Subscription, (s) => s.user)
  subscriptions: Subscription[];

  @OneToMany(() => PaymentCard, (c) => c.user)
  paymentCards: PaymentCard[];

  @Column({ nullable: true })
  billingSource: string;

  @Column({ default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ nullable: true, type: 'timestamp' })
  currentPeriodEnd: Date | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  downgradedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  gracePeriodEnd: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  gracePeriodReason: 'team_expired' | 'pro_expired' | null;

  @Column({ type: 'timestamp', nullable: true })
  billingIssueAt: Date | null;

  // --- Billing refactor (state machine) ---

  /**
   * Canonical billing state. Backfilled from existing flags in
   * BackfillBillingStatus migration and maintained by the billing
   * state machine going forward.
   */
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

  /**
   * Start of the active paid period. Needed alongside currentPeriodEnd
   * for RC_RENEWAL transitions + accurate period-over-period analytics.
   */
  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodStart: Date | null;

  /**
   * Pro-invite seat graph: NULL for plan owners; set to the inviter's
   * user id for members granted access through a Pro invite. FK is
   * ON DELETE SET NULL so deleting an inviter does not cascade-delete
   * their invitees (they lose access via a separate downgrade flow).
   */
  @Column({ type: 'uuid', nullable: true })
  invitedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
