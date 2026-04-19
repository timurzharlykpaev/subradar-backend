import { BannerInput, computeBannerPriority } from '../banner-priority';

describe('computeBannerPriority', () => {
  const base: BannerInput = {
    state: 'active',
    plan: 'pro',
    billingPeriod: 'monthly',
    cancelAtPeriodEnd: false,
    billingIssueAt: null,
    currentPeriodEnd: null,
    graceExpiresAt: null,
    graceReason: null,
    hasOwnPaidPlan: false,
    isTeamMember: false,
    isTeamOwner: false,
    hiddenSubscriptionsCount: 0,
    hadProBefore: false,
  };

  it('billing_issue wins over everything', () => {
    const r = computeBannerPriority({
      ...base,
      billingIssueAt: new Date(),
      state: 'billing_issue',
      // Even if other banners would normally trigger, billing_issue wins.
      hasOwnPaidPlan: true,
      isTeamMember: true,
    });
    expect(r.priority).toBe('billing_issue');
  });

  it('grace when state is grace_pro — reports daysLeft and reason', () => {
    const r = computeBannerPriority({
      ...base,
      state: 'grace_pro',
      graceReason: 'pro_expired',
      graceExpiresAt: new Date(Date.now() + 3 * 86_400_000),
    });
    expect(r.priority).toBe('grace');
    expect(r.payload).toMatchObject({ daysLeft: 3, reason: 'pro_expired' });
  });

  it('expiration when within 7 days and cancel_at_period_end', () => {
    const end = new Date(Date.now() + 5 * 86_400_000);
    const r = computeBannerPriority({
      ...base,
      state: 'cancel_at_period_end',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: end,
    });
    expect(r.priority).toBe('expiration');
    expect(r.payload).toMatchObject({ daysLeft: 5 });
  });

  it('double_pay when hasOwnPaidPlan and team member (not owner)', () => {
    const r = computeBannerPriority({
      ...base,
      hasOwnPaidPlan: true,
      isTeamMember: true,
      isTeamOwner: false,
      // Make billingPeriod yearly so annual_upgrade does not steal the match.
      billingPeriod: 'yearly',
    });
    expect(r.priority).toBe('double_pay');
  });

  it('annual_upgrade for monthly pro', () => {
    const r = computeBannerPriority({
      ...base,
      plan: 'pro',
      billingPeriod: 'monthly',
      hasOwnPaidPlan: true,
    });
    expect(r.priority).toBe('annual_upgrade');
    expect(r.payload).toMatchObject({ plan: 'pro' });
  });

  it('win_back when free but had pro before', () => {
    const r = computeBannerPriority({
      ...base,
      plan: 'free',
      state: 'free',
      hadProBefore: true,
    });
    expect(r.priority).toBe('win_back');
  });

  it('none for active yearly pro with own plan', () => {
    const r = computeBannerPriority({
      ...base,
      billingPeriod: 'yearly',
      hasOwnPaidPlan: true,
    });
    expect(r.priority).toBe('none');
  });
});
