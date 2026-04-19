import { RCSubscriberSnapshot, UserBillingSnapshot } from './types';
import { transition } from './transitions';

function hasActiveEntitlement(rc: RCSubscriberSnapshot): boolean {
  const now = Date.now();
  return Object.values(rc.entitlements).some(
    (e) => !e.expiresAt || e.expiresAt.getTime() > now,
  );
}

export function reconcile(
  current: UserBillingSnapshot,
  rc: RCSubscriberSnapshot,
): UserBillingSnapshot {
  const active = hasActiveEntitlement(rc);

  if (
    !active &&
    (current.state === 'active' ||
      current.state === 'cancel_at_period_end' ||
      current.state === 'billing_issue')
  ) {
    return transition(current, { type: 'RC_EXPIRATION' });
  }

  if (rc.billingIssueDetectedAt && current.state !== 'billing_issue') {
    try {
      return transition(current, { type: 'RC_BILLING_ISSUE' });
    } catch {
      /* ignore invalid transitions — leave as-is */
    }
  }

  if (active && current.state === 'billing_issue' && !rc.billingIssueDetectedAt) {
    // Looks healed — RENEWAL-like state
    if (rc.latestExpirationMs) {
      return transition(current, {
        type: 'RC_RENEWAL',
        periodStart: current.currentPeriodStart ?? new Date(),
        periodEnd: new Date(rc.latestExpirationMs),
      });
    }
  }

  if (rc.cancelAtPeriodEnd !== current.cancelAtPeriodEnd) {
    if (rc.cancelAtPeriodEnd && current.state === 'active') {
      return transition(current, {
        type: 'RC_CANCELLATION',
        periodEnd: new Date(rc.latestExpirationMs ?? Date.now()),
      });
    }
    if (!rc.cancelAtPeriodEnd && current.state === 'cancel_at_period_end') {
      return transition(current, { type: 'RC_UNCANCELLATION' });
    }
  }

  return current;
}
