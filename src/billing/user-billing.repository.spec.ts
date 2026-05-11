import { UserBillingRepository } from './user-billing.repository';

describe('UserBillingRepository', () => {
  const buildRepo = (fakeRow: any) => {
    const update = jest.fn();
    const txManager: any = {
      findOne: jest.fn().mockResolvedValue(fakeRow),
      update,
    };
    const billingRepoMock: any = { findOne: jest.fn().mockResolvedValue(fakeRow) };
    const dlqRepoMock: any = { insert: jest.fn().mockResolvedValue(undefined) };
    const auditMock: any = { log: jest.fn().mockResolvedValue(undefined) };
    const tgMock: any = { send: jest.fn().mockResolvedValue(true) };
    const effectiveMock: any = { invalidate: jest.fn(), invalidateAll: jest.fn() };
    const ds: any = { transaction: jest.fn(async (cb: any) => cb(txManager)) };
    const repo = new UserBillingRepository(
      billingRepoMock,
      dlqRepoMock,
      ds,
      auditMock,
      tgMock,
      effectiveMock,
    );
    return {
      repo,
      update,
      audit: auditMock,
      ds,
      txManager,
      billingRepoMock,
      dlqRepoMock,
      tgMock,
      effectiveMock,
    };
  };

  const freeUser = (overrides: any = {}) => ({
    userId: 'user-1',
    plan: 'free',
    billingStatus: 'free',
    billingSource: null,
    billingPeriod: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    gracePeriodEnd: null,
    gracePeriodReason: null,
    billingIssueAt: null,
        refundedAt: null,
    ...overrides,
  });

  it('is instantiable', () => {
    const { repo } = buildRepo(freeUser());
    expect(repo).toBeDefined();
  });

  describe('applyTransition', () => {
    it('applies RC_INITIAL_PURCHASE: persists snapshot + writes audit row', async () => {
      const { repo, update, audit } = buildRepo(freeUser());

      const periodEnd = new Date('2099-01-01');
      const result = await repo.applyTransition(
        'user-1',
        {
          type: 'RC_INITIAL_PURCHASE',
          plan: 'pro',
          period: 'monthly',
          periodStart: new Date('2099-01-01'),
          periodEnd,
        },
        { actor: 'sync' },
      );

      expect(result.applied).toBe(true);
      if (result.applied) {
        expect(result.from).toBe('free');
        expect(result.to).toBe('active');
        expect(result.snapshot.plan).toBe('pro');
      }
      expect(update).toHaveBeenCalledWith(
        expect.anything(),
        { userId: 'user-1' },
        expect.objectContaining({ plan: 'pro', billingStatus: 'active' }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          action: 'billing.transition',
          metadata: expect.objectContaining({ from: 'free', to: 'active' }),
        }),
      );
    });

    it('returns idempotent_noop when transition produces an unchanged snapshot', async () => {
      const { repo, update, audit } = buildRepo(freeUser());

      // RC_EXPIRATION on a `free` user is a no-op per the reducer.
      const result = await repo.applyTransition(
        'user-1',
        { type: 'RC_EXPIRATION' },
        { actor: 'reconcile' },
      );

      expect(result.applied).toBe(false);
      if (!result.applied) expect(result.reason).toBe('idempotent_noop');
      expect(update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('returns invalid_transition when reducer throws (and writes audit row)', async () => {
      const { repo, update, audit } = buildRepo(
        freeUser({
          plan: 'pro',
          billingStatus: 'active',
          billingSource: 'revenuecat',
          billingPeriod: 'monthly',
          currentPeriodEnd: new Date('2099-01-01'),
        }),
      );

      // RC_UNCANCELLATION on active sub is invalid per reducer.
      const result = await repo.applyTransition(
        'user-1',
        { type: 'RC_UNCANCELLATION' },
        { actor: 'webhook_rc' },
      );

      expect(result.applied).toBe(false);
      if (!result.applied) expect(result.reason).toBe('invalid_transition');
      expect(update).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.transition.invalid' }),
      );
    });

    it('uses provided manager (no implicit transaction)', async () => {
      const { repo, ds, txManager } = buildRepo(freeUser());
      // Pass a custom manager — ds.transaction must NOT be called.
      const customManager: any = {
        findOne: txManager.findOne,
        update: jest.fn(),
      };
      await repo.applyTransition(
        'user-1',
        {
          type: 'RC_INITIAL_PURCHASE',
          plan: 'pro',
          period: 'monthly',
          periodStart: new Date(),
          periodEnd: new Date('2099-01-01'),
        },
        { actor: 'webhook_rc', manager: customManager },
      );
      expect(ds.transaction).not.toHaveBeenCalled();
      expect(customManager.update).toHaveBeenCalled();
    });
  });
});
