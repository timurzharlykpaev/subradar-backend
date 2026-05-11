import { reconcile } from '../reconcile';
import { UserBillingSnapshot, RCSubscriberSnapshot } from '../types';

describe('reconcile', () => {
  it('marks grace_pro when RC has no active entitlement but DB thinks active', () => {
    const current: UserBillingSnapshot = {
      userId: 'u1',
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      billingPeriod: 'monthly',
      currentPeriodStart: new Date('2026-03-01'),
      currentPeriodEnd: new Date('2026-04-01'),
      cancelAtPeriodEnd: false,
      graceExpiresAt: null,
      graceReason: null,
      billingIssueAt: null,
        refundedAt: null,
    };
    const rc: RCSubscriberSnapshot = {
      entitlements: {},
      latestExpirationMs: new Date('2026-04-01').getTime(),
      cancelAtPeriodEnd: false,
      billingIssueDetectedAt: null,
    };
    const next = reconcile(current, rc);
    expect(next.state).toBe('grace_pro');
  });

  it('no-op when DB and RC agree on active pro', () => {
    const end = new Date(Date.now() + 10 * 86400_000);
    const current: UserBillingSnapshot = {
      userId: 'u1',
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      billingPeriod: 'monthly',
      currentPeriodStart: new Date(Date.now() - 20 * 86400_000),
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
      graceExpiresAt: null,
      graceReason: null,
      billingIssueAt: null,
        refundedAt: null,
    };
    const rc: RCSubscriberSnapshot = {
      entitlements: { pro: { expiresAt: end, productId: 'io.subradar.mobile.pro.monthly' } },
      latestExpirationMs: end.getTime(),
      cancelAtPeriodEnd: false,
      billingIssueDetectedAt: null,
    };
    const next = reconcile(current, rc);
    expect(next).toEqual(current);
  });

  it('marks billing_issue when RC reports billingIssueDetectedAt and DB is active', () => {
    const end = new Date(Date.now() + 10 * 86400_000);
    const current: UserBillingSnapshot = {
      userId: 'u1',
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      billingPeriod: 'monthly',
      currentPeriodStart: new Date(Date.now() - 20 * 86400_000),
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
      graceExpiresAt: null,
      graceReason: null,
      billingIssueAt: null,
        refundedAt: null,
    };
    const rc: RCSubscriberSnapshot = {
      entitlements: { pro: { expiresAt: end, productId: 'io.subradar.mobile.pro.monthly' } },
      latestExpirationMs: end.getTime(),
      cancelAtPeriodEnd: false,
      billingIssueDetectedAt: new Date(),
    };
    const next = reconcile(current, rc);
    expect(next.state).toBe('billing_issue');
    expect(next.billingIssueAt).toBeInstanceOf(Date);
  });

  it('moves active → cancel_at_period_end when RC reports cancelAtPeriodEnd=true', () => {
    const end = new Date(Date.now() + 10 * 86400_000);
    const current: UserBillingSnapshot = {
      userId: 'u1',
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      billingPeriod: 'monthly',
      currentPeriodStart: new Date(Date.now() - 20 * 86400_000),
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
      graceExpiresAt: null,
      graceReason: null,
      billingIssueAt: null,
        refundedAt: null,
    };
    const rc: RCSubscriberSnapshot = {
      entitlements: { pro: { expiresAt: end, productId: 'io.subradar.mobile.pro.monthly' } },
      latestExpirationMs: end.getTime(),
      cancelAtPeriodEnd: true,
      billingIssueDetectedAt: null,
    };
    const next = reconcile(current, rc);
    expect(next.state).toBe('cancel_at_period_end');
    expect(next.cancelAtPeriodEnd).toBe(true);
  });
});
