import { BillingEvent, InvalidTransitionError, UserBillingSnapshot } from './types';

export function transition(
  current: UserBillingSnapshot,
  event: BillingEvent,
): UserBillingSnapshot {
  switch (event.type) {
    case 'RC_INITIAL_PURCHASE':
      return {
        ...current,
        plan: event.plan,
        state: 'active',
        billingSource: 'revenuecat',
        billingPeriod: event.period,
        currentPeriodStart: event.periodStart,
        currentPeriodEnd: event.periodEnd,
        cancelAtPeriodEnd: false,
        graceExpiresAt: null,
        graceReason: null,
        billingIssueAt: null,
      };
    default:
      throw new InvalidTransitionError(current.state, event.type);
  }
}
