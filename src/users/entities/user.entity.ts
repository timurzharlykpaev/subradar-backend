import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Subscription } from '../../subscriptions/entities/subscription.entity';
import { PaymentCard } from '../../payment-cards/entities/payment-card.entity';
import { UserBilling } from '../../billing/entities/user-billing.entity';

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

  @Column({ type: 'timestamp', name: 'gmail_connected_at', nullable: true })
  gmailConnectedAt: Date | null;

  @Column({ type: 'timestamp', name: 'gmail_last_scan_at', nullable: true })
  gmailLastScanAt: Date | null;

  @Column({ type: 'int', name: 'gmail_last_import_count', nullable: true })
  gmailLastImportCount: number | null;

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

  // Per-user idempotency markers for the notification cron jobs.
  // Each handler compares `now() - lastXxxAt` against an interval window
  // (24h for daily, 6 days for weekly, 28 days for monthly) so a restart
  // or multi-pod deploy won't refire the same notification on the same
  // calendar day. Pattern matches existing `weeklyDigestSentAt`.
  @Column({ type: 'timestamp', nullable: true, default: null })
  lastTrialPushAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  lastProExpirationPushAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  lastProExpirationEmailAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  lastWeeklyPushDigestAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  lastWinBackPushAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  lastMonthlyReportSentAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  lastPaymentRemindersSentAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  @Exclude({ toPlainOnly: true })
  refreshTokenIssuedAt: Date | null;

  @OneToMany(() => Subscription, (s) => s.user)
  subscriptions: Subscription[];

  @OneToMany(() => PaymentCard, (c) => c.user)
  paymentCards: PaymentCard[];

  @Column({ type: 'timestamp', nullable: true, default: null })
  downgradedAt!: Date | null;

  // --- Billing state lives in `user_billing` (Phase 2) ---
  //
  // The 10 fields plan, billingStatus, billingSource, billingPeriod,
  // currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd,
  // gracePeriodEnd, gracePeriodReason, billingIssueAt have been moved
  // to the dedicated `user_billing` table. They're exposed here as
  // backward-compat getters that read from the eager-loaded relation,
  // so legacy callers like `user.plan` keep working without touching
  // every read-site. New code should prefer
  // `userBilling.read(userId)` for an explicit snapshot.
  //
  // Writes never go through these getters — they always go through
  // `UserBillingRepository.applyTransition`.
  @OneToOne(() => UserBilling, (b) => b.user, { eager: true })
  billing!: UserBilling | null;

  get plan(): string {
    return this.billing?.plan ?? 'free';
  }
  get billingStatus(): BillingStatus {
    return this.billing?.billingStatus ?? 'free';
  }
  get billingSource(): string | null {
    return this.billing?.billingSource ?? null;
  }
  get billingPeriod(): string | null {
    return this.billing?.billingPeriod ?? null;
  }
  get currentPeriodStart(): Date | null {
    return this.billing?.currentPeriodStart ?? null;
  }
  get currentPeriodEnd(): Date | null {
    return this.billing?.currentPeriodEnd ?? null;
  }
  get cancelAtPeriodEnd(): boolean {
    return this.billing?.cancelAtPeriodEnd ?? false;
  }
  get gracePeriodEnd(): Date | null {
    return this.billing?.gracePeriodEnd ?? null;
  }
  get gracePeriodReason(): 'team_expired' | 'pro_expired' | null {
    return this.billing?.gracePeriodReason ?? null;
  }
  get billingIssueAt(): Date | null {
    return this.billing?.billingIssueAt ?? null;
  }

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
