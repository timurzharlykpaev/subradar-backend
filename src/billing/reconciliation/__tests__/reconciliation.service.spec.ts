import { ReconciliationService } from '../reconciliation.service';

/**
 * Focused unit test: wire up the service with hand-rolled fakes and assert
 * the no-op path — when RC's snapshot agrees with the local snapshot, we
 * must not UPDATE, audit, or enqueue. Broader coverage (state transitions,
 * dry-run side effects) is exercised at the state-machine layer +
 * integration level.
 */
describe('ReconciliationService.reconcileOne', () => {
  it('no-op when states match', async () => {
    const update = jest.fn();
    const log = jest.fn();
    const enqueue = jest.fn();
    const periodEnd = new Date(Date.now() + 86_400_000);

    const svc = new ReconciliationService(
      { update } as any,
      {
        getSubscriber: jest.fn().mockResolvedValue({
          entitlements: {
            pro: {
              expiresAt: periodEnd,
              productId: 'io.subradar.mobile.pro.monthly',
            },
          },
          latestExpirationMs: periodEnd.getTime(),
          cancelAtPeriodEnd: false,
          billingIssueDetectedAt: null,
        }),
      } as any,
      { log } as any,
      { enqueue } as any,
    );

    const user: any = {
      id: 'u1',
      plan: 'pro',
      billingStatus: 'active',
      billingSource: 'revenuecat',
      billingPeriod: 'monthly',
      currentPeriodStart: new Date(),
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      gracePeriodEnd: null,
      gracePeriodReason: null,
      billingIssueAt: null,
        refundedAt: null,
    };

    const changed = await svc.reconcileOne(user, false);

    expect(changed).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
