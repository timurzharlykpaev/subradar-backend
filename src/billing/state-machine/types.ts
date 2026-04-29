export type BillingState =
  | 'free'
  | 'active'
  | 'cancel_at_period_end'
  | 'billing_issue'
  | 'grace_pro'
  | 'grace_team';

export type Plan = 'free' | 'pro' | 'organization';
export type BillingPeriod = 'monthly' | 'yearly';
export type BillingSource = 'revenuecat' | 'lemon_squeezy' | null;
export type GraceReason = 'team_expired' | 'pro_expired' | null;

export interface UserBillingSnapshot {
  userId: string;
  plan: Plan;
  state: BillingState;
  billingSource: BillingSource;
  billingPeriod: BillingPeriod | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  graceExpiresAt: Date | null;
  graceReason: GraceReason;
  billingIssueAt: Date | null;
}

export type BillingEvent =
  | { type: 'RC_INITIAL_PURCHASE'; plan: Exclude<Plan, 'free'>; period: BillingPeriod; periodStart: Date; periodEnd: Date }
  | { type: 'RC_RENEWAL'; periodStart: Date; periodEnd: Date }
  | { type: 'RC_PRODUCT_CHANGE'; newPlan: Exclude<Plan, 'free'>; period: BillingPeriod; periodStart: Date; periodEnd: Date }
  | { type: 'RC_CANCELLATION'; periodEnd: Date }
  | { type: 'RC_UNCANCELLATION' }
  | { type: 'RC_EXPIRATION' }
  | { type: 'RC_BILLING_ISSUE' }
  // Apple-issued refund — entitlement is reversed immediately, no period
  // continuation. The previous code path mapped this through the regular
  // CANCELLATION handler, which would have left the user with full Pro
  // access until period end after their money was returned.
  | { type: 'RC_REFUND' }
  | { type: 'TEAM_OWNER_EXPIRED'; memberHasOwnSub: boolean }
  | { type: 'TEAM_MEMBER_REMOVED' }
  | { type: 'GRACE_EXPIRED' }
  | { type: 'TRIAL_EXPIRED' }
  | { type: 'LS_SUBSCRIPTION_CREATED'; plan: Exclude<Plan, 'free'>; period: BillingPeriod; periodEnd: Date }
  | { type: 'LS_SUBSCRIPTION_UPDATED'; plan: Exclude<Plan, 'free'>; period: BillingPeriod; periodEnd: Date }
  | { type: 'LS_SUBSCRIPTION_CANCELLED' };

export class InvalidTransitionError extends Error {
  constructor(from: BillingState, eventType: string) {
    super(`Invalid billing transition: ${from} -> ${eventType}`);
    this.name = 'InvalidTransitionError';
  }
}

export interface RCSubscriberSnapshot {
  entitlements: Record<string, { expiresAt: Date | null; productId: string }>;
  latestExpirationMs: number | null;
  cancelAtPeriodEnd: boolean;
  billingIssueDetectedAt: Date | null;
}
