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

  // Grace recovery: backend put the user in grace (lost / late RENEWAL,
  // Apple charge retry that ultimately succeeded) but RC now reports an
  // active entitlement again. Treat as a RENEWAL so we clear graceExpiresAt
  // / graceReason and snap the user back to `active`. Without this, the
  // user keeps a "Pro expired — N days left" banner under a fully-paid sub
  // until the *next* RC webhook arrives, which can be weeks away for
  // yearly plans.
  if (
    active &&
    (current.state === 'grace_pro' || current.state === 'grace_team') &&
    rc.latestExpirationMs
  ) {
    return transition(current, {
      type: 'RC_RENEWAL',
      periodStart: current.currentPeriodStart ?? new Date(),
      periodEnd: new Date(rc.latestExpirationMs),
    });
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
