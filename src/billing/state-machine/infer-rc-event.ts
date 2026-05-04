import { BillingEvent, BillingPeriod, Plan, RCSubscriberSnapshot, UserBillingSnapshot } from './types';

function planFromProductId(productId: string | undefined): Exclude<Plan, 'free'> | null {
  if (!productId) return null;
  const lc = productId.toLowerCase();
  if (lc.includes('team') || lc.includes('org')) return 'organization';
  if (lc.includes('pro') || lc.includes('premium')) return 'pro';
  return null;
}

function periodFromProductId(productId: string | undefined): BillingPeriod {
  if (!productId) return 'monthly';
  return productId.toLowerCase().includes('yearly') ? 'yearly' : 'monthly';
}

interface PickedEntitlement {
  plan: Exclude<Plan, 'free'>;
  period: BillingPeriod;
  expiresAt: Date;
  productId: string;
}

function pickActiveEntitlement(
  rc: RCSubscriberSnapshot,
  hint?: string,
): PickedEntitlement | null {
  const now = Date.now();
  const isActive = (e: { expiresAt: Date | null }): boolean =>
    e.expiresAt == null || e.expiresAt.getTime() > now;

  if (hint) {
    for (const ent of Object.values(rc.entitlements)) {
      if (ent.productId === hint && isActive(ent) && ent.expiresAt) {
        const plan = planFromProductId(ent.productId);
        if (plan) {
          return {
            plan,
            period: periodFromProductId(ent.productId),
            expiresAt: ent.expiresAt,
            productId: ent.productId,
          };
        }
      }
    }
  }

  // When both Team and Pro entitlements are active, normally prefer Team
  // (higher tier) — BUT if Team is cancelled-at-period-end and Pro is
  // renewing, surface Pro instead. Otherwise the cancelled Team would
  // hide a freshly-purchased Pro from /billing/me until Team's period
  // elapses, leaving the user staring at a "TEAM" badge they no longer
  // own. willRenew is `false` only when RC reports
  // `unsubscribe_detected_at` for that entitlement's subscription;
  // `undefined` (snapshot didn't carry the flag) is treated as "still
  // renewing" for backwards compat.
  const active = Object.values(rc.entitlements).filter((e) => isActive(e) && e.expiresAt);
  const isRenewing = (e: { willRenew?: boolean }) => e.willRenew !== false;
  const team = active.find((e) => planFromProductId(e.productId) === 'organization');
  const pro = active.find((e) => planFromProductId(e.productId) === 'pro');
  let pick: typeof active[number] | undefined;
  if (team && pro) {
    if (isRenewing(team)) pick = team;
    else if (isRenewing(pro)) pick = pro;
    else pick = team; // both cancelled — keep precedence
  } else {
    pick = team ?? pro;
  }
  if (!pick) return null;
  const plan = planFromProductId(pick.productId);
  if (!plan || !pick.expiresAt) return null;
  return {
    plan,
    period: periodFromProductId(pick.productId),
    expiresAt: pick.expiresAt,
    productId: pick.productId,
  };
}

/**
 * Map a RevenueCat subscriber snapshot + the user's current billing state
 * onto a single BillingEvent — the same event the webhook would produce
 * for the equivalent transition. Returns null when nothing changed.
 *
 * The state machine itself stays oblivious to RC; this helper is the
 * only RC-aware piece outside the webhook event mapper.
 */
export function inferEventFromRcSnapshot(
  rc: RCSubscriberSnapshot,
  current: UserBillingSnapshot,
  productIdHint?: string,
): BillingEvent | null {
  const active = pickActiveEntitlement(rc, productIdHint);

  if (!active) {
    if (current.state === 'free') return null;
    const periodEnd = current.currentPeriodEnd;
    if (periodEnd && periodEnd.getTime() > Date.now()) {
      return { type: 'RC_CANCELLATION', periodEnd };
    }
    return { type: 'RC_EXPIRATION' };
  }

  if (
    rc.billingIssueDetectedAt &&
    (current.state === 'active' || current.state === 'cancel_at_period_end')
  ) {
    return { type: 'RC_BILLING_ISSUE' };
  }

  if (rc.cancelAtPeriodEnd) {
    return { type: 'RC_CANCELLATION', periodEnd: active.expiresAt };
  }

  // From `free` OR a grace state, treat any active RC entitlement as a
  // fresh INITIAL_PURCHASE — INITIAL_PURCHASE clears graceExpiresAt /
  // graceReason and lands the user on `active`. Without this, a user
  // who lapsed into grace_pro and then bought a new subscription
  // (Team or another Pro cycle) on the App Store could not exit grace
  // via reconcile: PRODUCT_CHANGE rejected grace as an invalid source
  // state, and "same plan, grace state" returned null and noop'd. The
  // user observed a forever "Pro expired" banner under a paid Team sub.
  if (
    current.state === 'free' ||
    current.state === 'grace_pro' ||
    current.state === 'grace_team'
  ) {
    return {
      type: 'RC_INITIAL_PURCHASE',
      plan: active.plan,
      period: active.period,
      periodStart: current.currentPeriodStart ?? new Date(),
      periodEnd: active.expiresAt,
    };
  }

  if (current.plan !== active.plan) {
    return {
      type: 'RC_PRODUCT_CHANGE',
      newPlan: active.plan,
      period: active.period,
      periodStart: current.currentPeriodStart ?? new Date(),
      periodEnd: active.expiresAt,
    };
  }

  // Lost UNCANCELLATION webhook recovery. Apple lets a user undo a
  // pending cancellation from iOS Settings → Subscriptions → Resubscribe;
  // RC then flips `unsubscribe_detected_at` back to null. If we still
  // have `cancel_at_period_end` stored from the original cancel webhook
  // and the matching RC entitlement is now renewing, surface an
  // RC_RENEWAL so transitions clears the cancel flag and snaps the user
  // back to `active`. Without this, a stuck `cancel_at_period_end` row
  // can't be repaired by reconcile — inferrer returns null, sync no-ops,
  // and the user keeps seeing an expiration banner under a fully-paid
  // auto-renewing subscription.
  if (current.state === 'cancel_at_period_end') {
    return {
      type: 'RC_RENEWAL',
      periodStart: current.currentPeriodStart ?? new Date(),
      periodEnd: active.expiresAt,
    };
  }

  return null;
}
