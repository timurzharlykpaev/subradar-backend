import { inferEventFromRcSnapshot } from '../infer-rc-event';
import { UserBillingSnapshot, RCSubscriberSnapshot } from '../types';

const baseSnap: UserBillingSnapshot = {
  userId: 'u',
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

const emptyRc: RCSubscriberSnapshot = {
  entitlements: {},
  latestExpirationMs: null,
  cancelAtPeriodEnd: false,
  billingIssueDetectedAt: null,
};

describe('inferEventFromRcSnapshot', () => {
  it('returns null when current=free and rc empty', () => {
    expect(inferEventFromRcSnapshot(emptyRc, baseSnap)).toBeNull();
  });

  it('emits RC_EXPIRATION when rc empty and period elapsed', () => {
    const past = new Date(Date.now() - 1000);
    const result = inferEventFromRcSnapshot(emptyRc, {
      ...baseSnap,
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      currentPeriodEnd: past,
    });
    expect(result).toEqual({ type: 'RC_EXPIRATION' });
  });

  it('emits RC_CANCELLATION when rc empty but period still active', () => {
    const future = new Date(Date.now() + 86400_000);
    const result = inferEventFromRcSnapshot(emptyRc, {
      ...baseSnap,
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      currentPeriodEnd: future,
    });
    expect(result).toEqual({ type: 'RC_CANCELLATION', periodEnd: future });
  });

  it('emits RC_CANCELLATION when rc.cancelAtPeriodEnd=true on otherwise active sub', () => {
    const future = new Date(Date.now() + 86400_000);
    const rc: RCSubscriberSnapshot = {
      entitlements: { pro: { expiresAt: future, productId: 'io.subradar.mobile.pro.monthly' } },
      latestExpirationMs: future.getTime(),
      cancelAtPeriodEnd: true,
      billingIssueDetectedAt: null,
    };
    const current: UserBillingSnapshot = {
      ...baseSnap,
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      currentPeriodEnd: future,
    };
    expect(inferEventFromRcSnapshot(rc, current)).toEqual({
      type: 'RC_CANCELLATION',
      periodEnd: future,
    });
  });

  it('emits RC_BILLING_ISSUE when rc reports billing issue on active sub', () => {
    const future = new Date(Date.now() + 86400_000);
    const rc: RCSubscriberSnapshot = {
      entitlements: { pro: { expiresAt: future, productId: 'io.subradar.mobile.pro.monthly' } },
      latestExpirationMs: future.getTime(),
      cancelAtPeriodEnd: false,
      billingIssueDetectedAt: new Date(),
    };
    const current: UserBillingSnapshot = {
      ...baseSnap,
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      currentPeriodEnd: future,
    };
    expect(inferEventFromRcSnapshot(rc, current)).toEqual({ type: 'RC_BILLING_ISSUE' });
  });

  it('emits RC_INITIAL_PURCHASE when current=free and rc has active pro', () => {
    const future = new Date(Date.now() + 86400_000);
    const rc: RCSubscriberSnapshot = {
      entitlements: { pro: { expiresAt: future, productId: 'io.subradar.mobile.pro.monthly' } },
      latestExpirationMs: future.getTime(),
      cancelAtPeriodEnd: false,
      billingIssueDetectedAt: null,
    };
    const result = inferEventFromRcSnapshot(rc, baseSnap, 'io.subradar.mobile.pro.monthly');
    expect(result).toMatchObject({
      type: 'RC_INITIAL_PURCHASE',
      plan: 'pro',
      period: 'monthly',
      periodEnd: future,
    });
  });

  it('emits RC_PRODUCT_CHANGE when current plan differs from rc', () => {
    const future = new Date(Date.now() + 86400_000);
    const rc: RCSubscriberSnapshot = {
      entitlements: { team: { expiresAt: future, productId: 'io.subradar.mobile.team.yearly' } },
      latestExpirationMs: future.getTime(),
      cancelAtPeriodEnd: false,
      billingIssueDetectedAt: null,
    };
    const current: UserBillingSnapshot = {
      ...baseSnap,
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      billingPeriod: 'monthly',
      currentPeriodEnd: future,
    };
    const result = inferEventFromRcSnapshot(rc, current, 'io.subradar.mobile.team.yearly');
    expect(result).toMatchObject({
      type: 'RC_PRODUCT_CHANGE',
      newPlan: 'organization',
      period: 'yearly',
      periodEnd: future,
    });
  });

  it('returns null when rc and current already match (no-op)', () => {
    const future = new Date(Date.now() + 86400_000);
    const rc: RCSubscriberSnapshot = {
      entitlements: { pro: { expiresAt: future, productId: 'io.subradar.mobile.pro.monthly' } },
      latestExpirationMs: future.getTime(),
      cancelAtPeriodEnd: false,
      billingIssueDetectedAt: null,
    };
    const current: UserBillingSnapshot = {
      ...baseSnap,
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      billingPeriod: 'monthly',
      currentPeriodEnd: future,
    };
    expect(inferEventFromRcSnapshot(rc, current)).toBeNull();
  });
});
