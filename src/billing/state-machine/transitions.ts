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
      // Allow from `active`, `cancel_at_period_end`, `billing_issue` too —
      // those happen on Restore Purchases (new device, reinstall) where RC
      // re-emits INITIAL_PURCHASE for an entitlement we already track.
      // Treating these as no-op-ish (refresh the period, clear billing
      // issue) is the only thing that keeps Restore from 500-ing — Apple
      // Review does test Restore on a fresh device.
      if (
        s.state !== 'free' &&
        s.state !== 'grace_pro' &&
        s.state !== 'grace_team' &&
        s.state !== 'active' &&
        s.state !== 'cancel_at_period_end' &&
        s.state !== 'billing_issue'
      ) {
        throw new InvalidTransitionError(s.state, e.type);
      }
      // If the user is on `cancel_at_period_end` and we're seeing the
      // *same* subscription replayed (same period end, same plan), keep
      // the cancellation intent — Restore must not silently un-cancel a
      // legitimately-cancelling subscription.
      const sameSubReplayed =
        s.state === 'cancel_at_period_end' &&
        s.plan === e.plan &&
        s.currentPeriodEnd != null &&
        Math.abs(s.currentPeriodEnd.getTime() - e.periodEnd.getTime()) <
          24 * 3600_000;
      const nextCancelAtPeriodEnd = sameSubReplayed ? s.cancelAtPeriodEnd : false;
      const nextState = sameSubReplayed ? s.state : 'active';
      return {
        ...s,
        plan: e.plan,
        state: nextState,
        billingSource: 'revenuecat',
        billingPeriod: e.period,
        currentPeriodStart: e.periodStart,
        currentPeriodEnd: e.periodEnd,
        cancelAtPeriodEnd: nextCancelAtPeriodEnd,
        graceExpiresAt: null,
        graceReason: null,
        billingIssueAt: null,
        // Clear refund marker — a returning subscriber should not see
        // a "refund processed" banner from a previous lifecycle.
        refundedAt: null,
      };

    case 'RC_RENEWAL':
      // Apple may auto-renew a subscription that was flagged for
      // cancellation if the user changed their mind in Settings (the
      // UNCANCELLATION webhook can be delayed or lost). Accept RENEWAL
      // from `cancel_at_period_end` too — clearing the cancel flag so
      // the user's paid period continues normally instead of crashing
      // the webhook (which would mean their money is taken but plan
      // stays "cancelling").
      if (
        s.state !== 'active' &&
        s.state !== 'billing_issue' &&
        s.state !== 'cancel_at_period_end'
      ) {
        throw new InvalidTransitionError(s.state, e.type);
      }
      return {
        ...s,
        state: 'active',
        currentPeriodStart: e.periodStart,
        currentPeriodEnd: e.periodEnd,
        billingIssueAt: null,
        cancelAtPeriodEnd: false,
        refundedAt: null,
      };

    case 'RC_PRODUCT_CHANGE':
      // Pro→Team mid-period upgrade is allowed by Apple even when the
      // current Pro is `cancel_at_period_end`. Previously throwing here
      // meant a user who cancelled Pro and then chose Team would see the
      // webhook fail and stay on Pro forever.
      if (s.state !== 'active' && s.state !== 'cancel_at_period_end') {
        throw new InvalidTransitionError(s.state, e.type);
      }
      return {
        ...s,
        plan: e.newPlan,
        state: 'active',
        billingPeriod: e.period,
        currentPeriodStart: e.periodStart,
        currentPeriodEnd: e.periodEnd,
        // The cancel-at-period-end flag belongs to the previous Pro
        // subscription and must be cleared on PRODUCT_CHANGE — Apple
        // issues a fresh subscription for the new product.
        cancelAtPeriodEnd: false,
        billingIssueAt: null,
        refundedAt: null,
      };

    case 'RC_CANCELLATION':
      // Idempotent on cancel_at_period_end: RC re-delivers CANCELLATION on
      // its own retries and Apple sometimes emits a second CANCELLATION
      // immediately after EXPIRATION (e.g. a refund-style flow that
      // re-stamps the row). Throwing here drops the idempotency record,
      // sends the webhook back to RC for retry, and loses any updated
      // periodEnd carried by the duplicate. Refresh-and-return is the
      // safer choice — the user's intent is unchanged.
      if (s.state === 'cancel_at_period_end') {
        return { ...s, currentPeriodEnd: e.periodEnd };
      }
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
      // Keep `plan` (pro/organization) while in grace — the user's tier is
      // unchanged during the win-back window and the
      // `billing_state_plan_consistent` CHECK constraint requires
      // state!='free' rows to also have plan!='free'. GRACE_EXPIRED is the
      // transition that drops both to 'free' once the grace window closes.
      return {
        ...s,
        state: 'grace_pro',
        graceExpiresAt: addDays(GRACE_PERIOD_DAYS),
        graceReason: 'pro_expired',
        cancelAtPeriodEnd: false,
        billingIssueAt: null,
      };

    case 'RC_REFUND':
      // Apple granted a refund. The receipt is reversed effective
      // immediately — no grace period, no period-end continuation. Drop
      // the user to free right away + stamp `refundedAt` so the UI can
      // surface a localized "refund processed" banner for the next 7
      // days (the window where the mobile UI distinguishes refund from
      // ordinary expiration). Idempotent on already-free rows — they
      // get the timestamp refreshed.
      return {
        ...s,
        plan: 'free',
        state: 'free',
        billingSource: null,
        billingPeriod: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        graceExpiresAt: null,
        graceReason: null,
        billingIssueAt: null,
        refundedAt: new Date(),
      };

    case 'RC_BILLING_ISSUE':
      if (s.state !== 'active' && s.state !== 'cancel_at_period_end') {
        if (s.state === 'billing_issue') return s;
        throw new InvalidTransitionError(s.state, e.type);
      }
      return { ...s, state: 'billing_issue', billingIssueAt: new Date() };

    case 'TEAM_OWNER_EXPIRED':
      if (e.memberHasOwnSub) return s;
      // Free-plan members never had paid access of their own — there's
      // nothing to grace, and writing (state='grace_team', plan='free')
      // would violate billing_state_plan_consistent. Leave the row alone.
      if (s.plan === 'free') return s;
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
      // Same constraint guard as TEAM_OWNER_EXPIRED: free-plan members
      // shouldn't be moved to grace_team (no paid access to grace, and the
      // CHECK constraint forbids state!='free' with plan='free').
      if (s.plan === 'free') return s;
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

    case 'TRIAL_EXPIRED':
      // Backend-only trial timer ran out. Skip if the user already moved
      // off trial (RC purchase superseded it, or already on free).
      if (s.state === 'free') return s;
      if (s.billingSource === 'revenuecat' || s.billingSource === 'lemon_squeezy') return s;
      return {
        ...s,
        plan: 'free',
        state: 'free',
        billingSource: null,
        billingPeriod: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        graceExpiresAt: null,
        graceReason: null,
        billingIssueAt: null,
      };

    case 'ADMIN_GRANT_PRO':
      // Owner-invitee grant — the invited user gets a paid plan attached
      // to no billing source. Only allowed from `free` so we never clobber
      // a real RC/LS subscription.
      if (s.state !== 'free') {
        throw new InvalidTransitionError(s.state, e.type);
      }
      return {
        ...s,
        plan: e.plan,
        state: 'active',
        billingSource: null,
        billingPeriod: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        graceExpiresAt: null,
        graceReason: null,
        billingIssueAt: null,
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
