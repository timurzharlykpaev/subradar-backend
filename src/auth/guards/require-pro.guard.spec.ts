import { Test } from '@nestjs/testing';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { RequireProGuard } from './require-pro.guard';
import { BillingService } from '../../billing/billing.service';
import { UsersService } from '../../users/users.service';

describe('RequireProGuard', () => {
  let guard: RequireProGuard;
  let billingService: { getEffectiveAccess: jest.Mock };
  let usersService: { findById: jest.Mock };

  const buildContext = (userId?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: userId ? { id: userId } : null }) }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    billingService = { getEffectiveAccess: jest.fn() };
    usersService = { findById: jest.fn().mockResolvedValue({ id: 'u1' }) };
    const module = await Test.createTestingModule({
      providers: [
        RequireProGuard,
        { provide: BillingService, useValue: billingService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();
    guard = module.get(RequireProGuard);
  });

  it('allows Pro users (own subscription)', async () => {
    billingService.getEffectiveAccess.mockResolvedValue({
      plan: 'pro',
      source: 'own',
      isTeamOwner: false,
      isTeamMember: false,
      hasOwnPro: true,
    });
    expect(await guard.canActivate(buildContext('u1'))).toBe(true);
  });

  it('allows Team owner', async () => {
    billingService.getEffectiveAccess.mockResolvedValue({
      plan: 'organization',
      source: 'own',
      isTeamOwner: true,
      isTeamMember: true,
      hasOwnPro: true,
    });
    expect(await guard.canActivate(buildContext('u1'))).toBe(true);
  });

  it('allows Team member (covered by team)', async () => {
    billingService.getEffectiveAccess.mockResolvedValue({
      plan: 'organization',
      source: 'team',
      isTeamOwner: false,
      isTeamMember: true,
      hasOwnPro: false,
    });
    expect(await guard.canActivate(buildContext('u1'))).toBe(true);
  });

  it('allows users in trial (Pro source own, hasOwnPro=false)', async () => {
    billingService.getEffectiveAccess.mockResolvedValue({
      plan: 'pro',
      source: 'own',
      isTeamOwner: false,
      isTeamMember: false,
      hasOwnPro: false,
    });
    expect(await guard.canActivate(buildContext('u1'))).toBe(true);
  });

  it('rejects Free users with 402', async () => {
    billingService.getEffectiveAccess.mockResolvedValue({
      plan: 'free',
      source: 'free',
      isTeamOwner: false,
      isTeamMember: false,
      hasOwnPro: false,
    });
    await expect(guard.canActivate(buildContext('u1'))).rejects.toThrow(HttpException);
    await expect(guard.canActivate(buildContext('u1'))).rejects.toMatchObject({ status: 402 });
  });

  it('rejects requests without authenticated user as 401', async () => {
    await expect(guard.canActivate(buildContext())).rejects.toMatchObject({ status: 401 });
  });

  it('rejects requests when user not found in DB as 401', async () => {
    usersService.findById.mockResolvedValue(null);
    await expect(guard.canActivate(buildContext('ghost'))).rejects.toMatchObject({ status: 401 });
  });
});
