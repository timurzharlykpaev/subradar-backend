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
});
