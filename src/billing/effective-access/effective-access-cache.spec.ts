import { EffectiveAccessResolver } from './effective-access.service';

/**
 * Cache behaviour test — invokes a stubbed resolver via reflection so we
 * don't have to spin up a real TypeORM repo just to verify the in-memory
 * Map TTL logic. The point is: invalidate() forgets the entry, expired
 * entries get recomputed, and cache hits don't re-call computeResolve.
 */
describe('EffectiveAccessResolver cache', () => {
  function buildResolver() {
    const resolver = new (EffectiveAccessResolver as any)(
      {} /* users */,
      {} /* trials */,
      {} /* workspaces */,
      {} /* members */,
      {} /* subs */,
    );
    let computeCount = 0;
    resolver.computeResolve = jest.fn(async (userId: string) => {
      computeCount++;
      return {
        effective: {
          plan: 'free',
          source: 'free',
          state: 'free',
          billingPeriod: null,
        },
        userId,
        callCount: computeCount,
      } as any;
    });
    return { resolver, getComputeCount: () => computeCount };
  }

  it('first call invokes computeResolve', async () => {
    const { resolver, getComputeCount } = buildResolver();
    await resolver.resolve('u-1');
    expect(getComputeCount()).toBe(1);
  });

  it('second call within TTL returns cached value', async () => {
    const { resolver, getComputeCount } = buildResolver();
    await resolver.resolve('u-1');
    await resolver.resolve('u-1');
    expect(getComputeCount()).toBe(1);
  });

  it('different user does not hit the same cache entry', async () => {
    const { resolver, getComputeCount } = buildResolver();
    await resolver.resolve('u-1');
    await resolver.resolve('u-2');
    expect(getComputeCount()).toBe(2);
  });

  it('invalidate(userId) forces recompute on next read', async () => {
    const { resolver, getComputeCount } = buildResolver();
    await resolver.resolve('u-1');
    resolver.invalidate('u-1');
    await resolver.resolve('u-1');
    expect(getComputeCount()).toBe(2);
  });

  it('invalidateAll() drops every entry', async () => {
    const { resolver, getComputeCount } = buildResolver();
    await resolver.resolve('u-1');
    await resolver.resolve('u-2');
    resolver.invalidateAll();
    await resolver.resolve('u-1');
    await resolver.resolve('u-2');
    expect(getComputeCount()).toBe(4);
  });

  it('expired entry (TTL passed) recomputes', async () => {
    const { resolver, getComputeCount } = buildResolver();
    await resolver.resolve('u-1');
    // Force the cached entry to expire by reaching into the private Map.
    const entry = (resolver as any).cache.get('u-1');
    entry.expiresAt = Date.now() - 1;
    await resolver.resolve('u-1');
    expect(getComputeCount()).toBe(2);
  });
});
