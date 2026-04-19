import { transition } from '../transitions';
import { UserBillingSnapshot } from '../types';

function freeSnapshot(): UserBillingSnapshot {
  return {
    userId: 'u1',
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
}

describe('BillingStateMachine.transition', () => {
  it('RC_INITIAL_PURCHASE free → active', () => {
    const start = new Date('2026-04-19T00:00:00Z');
    const end = new Date('2026-05-19T00:00:00Z');
    const next = transition(freeSnapshot(), {
      type: 'RC_INITIAL_PURCHASE',
      plan: 'pro',
      period: 'monthly',
      periodStart: start,
      periodEnd: end,
    });
    expect(next.state).toBe('active');
    expect(next.plan).toBe('pro');
    expect(next.billingSource).toBe('revenuecat');
    expect(next.currentPeriodStart).toEqual(start);
    expect(next.currentPeriodEnd).toEqual(end);
    expect(next.cancelAtPeriodEnd).toBe(false);
  });

  it('active → cancel_at_period_end on RC_CANCELLATION', () => {
    const active: UserBillingSnapshot = {
      ...freeSnapshot(),
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      billingPeriod: 'monthly',
      currentPeriodEnd: new Date('2026-05-19'),
    };
    const end = new Date('2026-05-19T00:00:00Z');
    const next = transition(active, { type: 'RC_CANCELLATION', periodEnd: end });
    expect(next.state).toBe('cancel_at_period_end');
    expect(next.cancelAtPeriodEnd).toBe(true);
    expect(next.currentPeriodEnd).toEqual(end);
    expect(next.plan).toBe('pro');
  });

  it('cancel_at_period_end → active on RC_UNCANCELLATION', () => {
    const cap: UserBillingSnapshot = {
      ...freeSnapshot(),
      plan: 'pro',
      state: 'cancel_at_period_end',
      billingSource: 'revenuecat',
      cancelAtPeriodEnd: true,
    };
    const next = transition(cap, { type: 'RC_UNCANCELLATION' });
    expect(next.state).toBe('active');
    expect(next.cancelAtPeriodEnd).toBe(false);
  });

  it('active → grace_pro on RC_EXPIRATION', () => {
    const active: UserBillingSnapshot = {
      ...freeSnapshot(),
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
    };
    const next = transition(active, { type: 'RC_EXPIRATION' });
    expect(next.state).toBe('grace_pro');
    expect(next.plan).toBe('free');
    expect(next.graceReason).toBe('pro_expired');
    expect(next.graceExpiresAt).toBeInstanceOf(Date);
    const delta = next.graceExpiresAt!.getTime() - Date.now();
    expect(delta).toBeGreaterThan(6.9 * 86400 * 1000);
    expect(delta).toBeLessThan(7.1 * 86400 * 1000);
  });

  it('active → billing_issue on RC_BILLING_ISSUE', () => {
    const active: UserBillingSnapshot = {
      ...freeSnapshot(),
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
    };
    const next = transition(active, { type: 'RC_BILLING_ISSUE' });
    expect(next.state).toBe('billing_issue');
    expect(next.billingIssueAt).toBeInstanceOf(Date);
    expect(next.plan).toBe('pro');
  });

  it('billing_issue → active on RC_RENEWAL', () => {
    const bi: UserBillingSnapshot = {
      ...freeSnapshot(),
      plan: 'pro',
      state: 'billing_issue',
      billingSource: 'revenuecat',
      billingIssueAt: new Date(),
    };
    const start = new Date('2026-04-19');
    const end = new Date('2026-05-19');
    const next = transition(bi, { type: 'RC_RENEWAL', periodStart: start, periodEnd: end });
    expect(next.state).toBe('active');
    expect(next.billingIssueAt).toBeNull();
    expect(next.currentPeriodEnd).toEqual(end);
  });

  it('grace_pro → free on GRACE_EXPIRED', () => {
    const grace: UserBillingSnapshot = {
      ...freeSnapshot(),
      state: 'grace_pro',
      graceReason: 'pro_expired',
      graceExpiresAt: new Date(Date.now() - 1000),
    };
    const next = transition(grace, { type: 'GRACE_EXPIRED' });
    expect(next.state).toBe('free');
    expect(next.plan).toBe('free');
    expect(next.graceExpiresAt).toBeNull();
    expect(next.graceReason).toBeNull();
  });

  it('grace_pro → active on new RC_INITIAL_PURCHASE', () => {
    const grace: UserBillingSnapshot = { ...freeSnapshot(), state: 'grace_pro' };
    const next = transition(grace, {
      type: 'RC_INITIAL_PURCHASE',
      plan: 'pro',
      period: 'monthly',
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 86400_000),
    });
    expect(next.state).toBe('active');
    expect(next.graceExpiresAt).toBeNull();
  });

  it('active → grace_team on TEAM_OWNER_EXPIRED when memberHasOwnSub=false', () => {
    const member: UserBillingSnapshot = {
      ...freeSnapshot(),
      plan: 'organization',
      state: 'active',
      billingSource: null,
    };
    const next = transition(member, { type: 'TEAM_OWNER_EXPIRED', memberHasOwnSub: false });
    expect(next.state).toBe('grace_team');
    expect(next.graceReason).toBe('team_expired');
  });

  it('active stays active on TEAM_OWNER_EXPIRED when memberHasOwnSub=true', () => {
    const member: UserBillingSnapshot = {
      ...freeSnapshot(),
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
    };
    const next = transition(member, { type: 'TEAM_OWNER_EXPIRED', memberHasOwnSub: true });
    expect(next.state).toBe('active');
    expect(next.plan).toBe('pro');
  });

  it('throws InvalidTransitionError on free + RC_RENEWAL', () => {
    expect(() =>
      transition(freeSnapshot(), {
        type: 'RC_RENEWAL',
        periodStart: new Date(),
        periodEnd: new Date(),
      }),
    ).toThrow('Invalid billing transition: free -> RC_RENEWAL');
  });

  it('active → active with new plan/period on RC_PRODUCT_CHANGE', () => {
    const active: UserBillingSnapshot = {
      ...freeSnapshot(),
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      billingPeriod: 'monthly',
    };
    const start = new Date('2026-04-19');
    const end = new Date('2027-04-19');
    const next = transition(active, {
      type: 'RC_PRODUCT_CHANGE',
      newPlan: 'organization',
      period: 'yearly',
      periodStart: start,
      periodEnd: end,
    });
    expect(next.state).toBe('active');
    expect(next.plan).toBe('organization');
    expect(next.billingPeriod).toBe('yearly');
    expect(next.currentPeriodStart).toEqual(start);
    expect(next.currentPeriodEnd).toEqual(end);
  });

  it('LS_SUBSCRIPTION_CREATED free → active with lemon_squeezy source', () => {
    const end = new Date('2026-05-19');
    const next = transition(freeSnapshot(), {
      type: 'LS_SUBSCRIPTION_CREATED',
      plan: 'pro',
      period: 'monthly',
      periodEnd: end,
    });
    expect(next.state).toBe('active');
    expect(next.plan).toBe('pro');
    expect(next.billingSource).toBe('lemon_squeezy');
    expect(next.billingPeriod).toBe('monthly');
    expect(next.currentPeriodEnd).toEqual(end);
  });

  it('LS_SUBSCRIPTION_CANCELLED → free', () => {
    const active: UserBillingSnapshot = {
      ...freeSnapshot(),
      plan: 'pro',
      state: 'active',
      billingSource: 'lemon_squeezy',
      billingPeriod: 'monthly',
    };
    const next = transition(active, { type: 'LS_SUBSCRIPTION_CANCELLED' });
    expect(next.state).toBe('free');
    expect(next.plan).toBe('free');
    expect(next.billingSource).toBeNull();
    expect(next.cancelAtPeriodEnd).toBe(false);
  });

  it('RC_EXPIRATION is a no-op when already in grace_pro', () => {
    const grace: UserBillingSnapshot = {
      ...freeSnapshot(),
      state: 'grace_pro',
      graceReason: 'pro_expired',
      graceExpiresAt: new Date(Date.now() + 5 * 86400_000),
    };
    const next = transition(grace, { type: 'RC_EXPIRATION' });
    expect(next).toEqual(grace);
  });

  it('throws InvalidTransitionError on free + RC_UNCANCELLATION', () => {
    expect(() => transition(freeSnapshot(), { type: 'RC_UNCANCELLATION' })).toThrow(
      'Invalid billing transition: free -> RC_UNCANCELLATION',
    );
  });

  it('GRACE_EXPIRED is a no-op when not in grace state', () => {
    const active: UserBillingSnapshot = {
      ...freeSnapshot(),
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
    };
    const next = transition(active, { type: 'GRACE_EXPIRED' });
    expect(next).toEqual(active);
  });

  it('cancel_at_period_end → billing_issue on RC_BILLING_ISSUE', () => {
    const cap: UserBillingSnapshot = {
      ...freeSnapshot(),
      plan: 'pro',
      state: 'cancel_at_period_end',
      billingSource: 'revenuecat',
      cancelAtPeriodEnd: true,
    };
    const next = transition(cap, { type: 'RC_BILLING_ISSUE' });
    expect(next.state).toBe('billing_issue');
    expect(next.billingIssueAt).toBeInstanceOf(Date);
  });
});
