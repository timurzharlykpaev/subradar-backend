/**
 * BillingMeResponse — canonical shape returned by `GET /billing/me`.
 *
 * This is the single source of truth for the mobile/web clients.
 * It is derived purely from persisted User + UserTrial + Workspace
 * state by {@link EffectiveAccessResolver}; callers must not try to
 * recompute any of these flags themselves.
 *
 * Mirrors spec section 5.1 of docs/superpowers/plans/
 *   2026-04-19-subscription-refactor-backend.md
 */

/**
 * Banner priority shown at the top of the billing UI. Ordered from
 * highest to lowest urgency; `computeBannerPriority` picks exactly one.
 */
export type BannerPriority =
  | 'billing_issue'
  | 'grace'
  | 'expiration'
  | 'double_pay'
  | 'annual_upgrade'
  | 'refund'
  | 'win_back'
  | 'none';

export interface BillingMeResponse {
  effective: {
    plan: 'free' | 'pro' | 'organization';
    source: 'own' | 'team' | 'trial' | 'grace_pro' | 'grace_team' | 'free';
    state:
      | 'active'
      | 'cancel_at_period_end'
      | 'billing_issue'
      | 'grace_pro'
      | 'grace_team'
      | 'free';
    billingPeriod: 'monthly' | 'yearly' | null;
  };
  ownership: {
    hasOwnPaidPlan: boolean;
    isTeamOwner: boolean;
    isTeamMember: boolean;
    teamOwnerId: string | null;
    workspaceId: string | null;
  };
  dates: {
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    nextPaymentDate: string | null;
    graceExpiresAt: string | null;
    graceDaysLeft: number | null;
    trialEndsAt: string | null;
    billingIssueStartedAt: string | null;
    /**
     * Timestamp when the most recent Apple/Google refund was processed
     * (RC_REFUND webhook). Null in every other state. Mobile shows a
     * "refund processed" banner for 7 days after this stamp so the
     * downgrade reads as a refund, not silent breakage. Field is
     * optional on the wire so old mobile clients that don't know
     * about it simply ignore it.
     */
    refundedAt?: string | null;
  };
  flags: {
    cancelAtPeriodEnd: boolean;
    hasBillingIssue: boolean;
    trialEligible: boolean;
    shouldShowDoublePay: boolean;
    degradedMode: boolean;
    hiddenSubscriptionsCount: number;
    graceReason: 'team_expired' | 'pro_expired' | null;
  };
  banner: {
    priority: BannerPriority;
    payload: Record<string, unknown>;
  };
  limits: {
    subscriptions: { used: number; limit: number | null };
    aiRequests: { used: number; limit: number | null; resetAt: string };
    canCreateOrg: boolean;
    canInvite: boolean;
  };
  actions: {
    canStartTrial: boolean;
    canCancel: boolean;
    canRestore: boolean;
    canUpgradeToYearly: boolean;
    canInviteProFriend: boolean;
  };
  products: {
    pro: { monthly: string; yearly: string };
    team: { monthly: string; yearly: string };
  };
  serverTime: string;
}
