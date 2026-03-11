import { Test } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SubscriptionLimitGuard } from './subscription-limit.guard';
import { Subscription, SubscriptionStatus } from '../entities/subscription.entity';

describe('SubscriptionLimitGuard', () => {
  let guard: SubscriptionLimitGuard;

  const mockRepo = {
    count: jest.fn(),
  };

  const makeContext = (user: any): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as ExecutionContext);

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        SubscriptionLimitGuard,
        { provide: getRepositoryToken(Subscription), useValue: mockRepo },
      ],
    }).compile();

    guard = mod.get(SubscriptionLimitGuard);
    jest.clearAllMocks();
  });

  it('should be defined', () => expect(guard).toBeDefined());

  it('allows when user is null/undefined', async () => {
    const ctx = makeContext(undefined);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockRepo.count).not.toHaveBeenCalled();
  });

  it('allows pro user (unlimited subscriptions)', async () => {
    const ctx = makeContext({ id: 'user-1', plan: 'pro' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockRepo.count).not.toHaveBeenCalled();
  });

  it('allows organization user (unlimited subscriptions)', async () => {
    const ctx = makeContext({ id: 'user-1', plan: 'organization' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockRepo.count).not.toHaveBeenCalled();
  });

  it('allows free user under limit (count < 5)', async () => {
    mockRepo.count.mockResolvedValue(3);
    const ctx = makeContext({ id: 'user-1', plan: 'free' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockRepo.count).toHaveBeenCalled();
  });

  it('blocks free user at limit (count >= 5)', async () => {
    mockRepo.count.mockResolvedValue(5);
    const ctx = makeContext({ id: 'user-1', plan: 'free' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('blocks free user above limit (count > 5)', async () => {
    mockRepo.count.mockResolvedValue(7);
    const ctx = makeContext({ id: 'user-1', plan: 'free' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('uses free plan when user.plan is undefined', async () => {
    mockRepo.count.mockResolvedValue(6);
    const ctx = makeContext({ id: 'user-1' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('ForbiddenException contains SUBSCRIPTION_LIMIT_REACHED code', async () => {
    mockRepo.count.mockResolvedValue(5);
    const ctx = makeContext({ id: 'user-1', plan: 'free' });
    try {
      await guard.canActivate(ctx);
      fail('Expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({
        error: expect.objectContaining({ code: 'SUBSCRIPTION_LIMIT_REACHED' }),
      });
    }
  });
});
