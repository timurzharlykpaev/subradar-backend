import { Test } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SubscriptionLimitGuard } from './subscription-limit.guard';
import { Subscription } from '../entities/subscription.entity';
import { User } from '../../users/entities/user.entity';
import { BillingService } from '../../billing/billing.service';

describe('SubscriptionLimitGuard', () => {
  let guard: SubscriptionLimitGuard;

  const mockSubRepo = {
    count: jest.fn(),
  };

  const mockUserRepo = {
    findOne: jest.fn(),
  };

  const mockBillingService = {
    getEffectiveAccess: jest.fn().mockResolvedValue({ plan: 'free' }),
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
        { provide: getRepositoryToken(Subscription), useValue: mockSubRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: BillingService, useValue: mockBillingService },
      ],
    }).compile();

    guard = mod.get(SubscriptionLimitGuard);
    jest.clearAllMocks();
    mockBillingService.getEffectiveAccess.mockResolvedValue({ plan: 'free' });
  });

  it('should be defined', () => expect(guard).toBeDefined());

  it('allows when user is null/undefined', async () => {
    const ctx = makeContext(undefined);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockUserRepo.findOne).not.toHaveBeenCalled();
  });

  it('returns true when DB user not found', async () => {
    mockUserRepo.findOne.mockResolvedValueOnce(null);
    const ctx = makeContext({ id: 'user-1' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('returns true when billing check passes', async () => {
    mockUserRepo.findOne.mockResolvedValueOnce({ id: 'user-1', plan: 'free' });
    const ctx = makeContext({ id: 'user-1', plan: 'free' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockBillingService.getEffectiveAccess).toHaveBeenCalled();
  });

  it('returns true even if billing check throws', async () => {
    mockUserRepo.findOne.mockResolvedValueOnce({ id: 'user-1', plan: 'free' });
    mockBillingService.getEffectiveAccess.mockRejectedValueOnce(new Error('fail'));
    const ctx = makeContext({ id: 'user-1', plan: 'free' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });
});
