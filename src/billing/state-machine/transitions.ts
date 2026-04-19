import { BillingEvent, InvalidTransitionError, UserBillingSnapshot } from './types';

const GRACE_PERIOD_DAYS = 7;

function addDays(days: number): Date {
  return new Date(Date.now() + days * 86400_000);
}

export function transition(
  s: UserBillingSnapshot,
  e: BillingEvent,
): UserBillingSnapshot {
  switch (e.type) {
    case 'RC_INITIAL_PURCHASE':
      if (s.state !== 'free' && s.state !== 'grace_pro' && s.state !== 'grace_team') {
        throw new InvalidTransitionError(s.state, e.type);
      }
      return {
        ...s,
        plan: e.plan,
        state: 'active',
        billingSource: 'revenuecat',
        billingPeriod: e.period,
        currentPeriodStart: e.periodStart,
        currentPeriodEnd: e.periodEnd,
        cancelAtPeriodEnd: false,
        graceExpiresAt: null,
        graceReason: null,
        billingIssueAt: null,
      };

    case 'RC_RENEWAL':
      if (s.state !== 'active' && s.state !== 'billing_issue') {
        throw new InvalidTransitionError(s.state, e.type);
      }
      return {
        ...s,
        state: 'active',
        currentPeriodStart: e.periodStart,
        currentPeriodEnd: e.periodEnd,
        billingIssueAt: null,
        cancelAtPeriodEnd: false,
      };

    case 'RC_PRODUCT_CHANGE':
      if (s.state !== 'active') throw new InvalidTransitionError(s.state, e.type);
      return {
        ...s,
        plan: e.newPlan,
        billingPeriod: e.period,
        currentPeriodStart: e.periodStart,
        currentPeriodEnd: e.periodEnd,
      };

    case 'RC_CANCELLATION':
      if (s.state !== 'active' && s.state !== 'billing_issue') {
        throw new InvalidTransitionError(s.state, e.type);
      }
      return {
        ...s,
        state: 'cancel_at_period_end',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: e.periodEnd,
      };

    case 'RC_UNCANCELLATION':
      if (s.state !== 'cancel_at_period_end') throw new InvalidTransitionError(s.state, e.type);
      return { ...s, state: 'active', cancelAtPeriodEnd: false };

    case 'RC_EXPIRATION':
      if (s.state === 'free' || s.state === 'grace_pro' || s.state === 'grace_team') return s;
      return {
        ...s,
        plan: 'free',
        state: 'grace_pro',
        graceExpiresAt: addDays(GRACE_PERIOD_DAYS),
        graceReason: 'pro_expired',
        cancelAtPeriodEnd: false,
        billingIssueAt: null,
      };

    case 'RC_BILLING_ISSUE':
      if (s.state !== 'active' && s.state !== 'cancel_at_period_end') {
        if (s.state === 'billing_issue') return s;
        throw new InvalidTransitionError(s.state, e.type);
      }
      return { ...s, state: 'billing_issue', billingIssueAt: new Date() };

    case 'TEAM_OWNER_EXPIRED':
      if (e.memberHasOwnSub) return s;
      return {
        ...s,
        state: 'grace_team',
        graceExpiresAt: addDays(GRACE_PERIOD_DAYS),
        graceReason: 'team_expired',
      };

    case 'TEAM_MEMBER_REMOVED':
      if (s.billingSource === 'revenuecat' && !s.cancelAtPeriodEnd && s.state === 'active') {
        return s; // member had own sub — keep
      }
      return {
        ...s,
        state: 'grace_team',
        graceExpiresAt: addDays(GRACE_PERIOD_DAYS),
        graceReason: 'team_expired',
      };

    case 'GRACE_EXPIRED':
      if (s.state !== 'grace_pro' && s.state !== 'grace_team') return s;
      return {
        ...s,
        plan: 'free',
        state: 'free',
        graceExpiresAt: null,
        graceReason: null,
        billingSource: null,
      };

    case 'LS_SUBSCRIPTION_CREATED':
    case 'LS_SUBSCRIPTION_UPDATED':
      return {
        ...s,
        plan: e.plan,
        state: 'active',
        billingSource: 'lemon_squeezy',
        billingPeriod: e.period,
        currentPeriodEnd: e.periodEnd,
        cancelAtPeriodEnd: false,
        graceExpiresAt: null,
        graceReason: null,
      };

    case 'LS_SUBSCRIPTION_CANCELLED':
      return {
        ...s,
        plan: 'free',
        state: 'free',
        billingSource: null,
        cancelAtPeriodEnd: false,
      };

    default: {
      const _exhaustive: never = e;
      void _exhaustive;
      throw new InvalidTransitionError(s.state, (e as BillingEvent).type);
    }
  }
}
