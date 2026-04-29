import {
  BillingPeriod,
  BillingState,
  GraceReason,
  Plan,
} from '../state-machine/types';
import { BannerPriority } from './billing-me.types';

/**
 * Input for {@link computeBannerPriority}. Pure data — no IO, no DB.
 * Keep it that way: the resolver pre-fetches everything.
 */
export interface BannerInput {
  state: BillingState;
  plan: Plan;
  billingPeriod: BillingPeriod | null;
  cancelAtPeriodEnd: boolean;
  billingIssueAt: Date | null;
  currentPeriodEnd: Date | null;
  graceExpiresAt: Date | null;
  graceReason: GraceReason;
  hasOwnPaidPlan: boolean;
  isTeamMember: boolean;
  isTeamOwner: boolean;
  hiddenSubscriptionsCount: number;
  hadProBefore: boolean;
}

export interface BannerResult {
  priority: BannerPriority;
  payload: Record<string, unknown>;
}

const DAY_MS = 86_400_000;

/**
 * Ceil number of whole days between `a` (future) and `b` (now).
 * Clamped to >= 0 so an already-expired deadline never returns a
 * negative value (frontend uses this directly for copy like
 * "3 days left").
 */
function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.ceil((a.getTime() - b.getTime()) / DAY_MS));
}

/**
 * Pick exactly one banner to show the user. Priorities are evaluated
 * top-to-bottom and the first match wins — do not reorder without
 * updating the spec.
 *
 *   1. billing_issue   payment failed, needs immediate action
 *   2. grace           paid access lost but still in 7-day window
 *   3. expiration      cancel_at_period_end AND <= 7 days left
 *   4. double_pay      owns a paid plan but also belongs to a team
 *   5. annual_upgrade  paid monthly — nudge to yearly for savings
 *   6. win_back        free, but previously paid (downgradedAt set)
 *   7. none            happy path
 */
export function computeBannerPriority(input: BannerInput): BannerResult {
  const now = new Date();

  if (input.state === 'billing_issue' || input.billingIssueAt) {
    return {
      priority: 'billing_issue',
      payload: {
        startedAt: input.billingIssueAt?.toISOString() ?? null,
      },
    };
  }

  if (
    (input.state === 'grace_pro' || input.state === 'grace_team') &&
    input.graceExpiresAt
  ) {
    return {
      priority: 'grace',
      payload: {
        daysLeft: daysBetween(input.graceExpiresAt, now),
        reason: input.graceReason,
      },
    };
  }

  if (input.state === 'cancel_at_period_end' && input.currentPeriodEnd) {
    const daysLeft = daysBetween(input.currentPeriodEnd, now);
    if (daysLeft <= 7) {
      return {
        priority: 'expiration',
        payload: {
          daysLeft,
          endsAt: input.currentPeriodEnd.toISOString(),
          // `plan` is needed so the mobile banner can render
          // "Pro ends in N days" vs "Team ends in N days" instead of
          // hardcoding "Pro" for Team owners who cancelled.
          plan: input.plan,
        },
      };
    }
  }

  if (input.hasOwnPaidPlan && input.isTeamMember && !input.isTeamOwner) {
    return { priority: 'double_pay', payload: {} };
  }

  if (
    input.hasOwnPaidPlan &&
    input.billingPeriod === 'monthly' &&
    (input.plan === 'pro' || input.plan === 'organization')
  ) {
    return { priority: 'annual_upgrade', payload: { plan: input.plan } };
  }

  if (
    input.plan === 'free' &&
    input.state === 'free' &&
    input.hadProBefore
  ) {
    return { priority: 'win_back', payload: {} };
  }

  return { priority: 'none', payload: {} };
}
