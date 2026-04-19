import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { UsersService } from '../users/users.service';
import { EffectiveAccessResolver } from './effective-access/effective-access.service';
import { TrialsService } from './trials/trials.service';

describe('BillingController', () => {
  let controller: BillingController;

  const mockBillingService = {
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    handleWebhook: jest.fn().mockResolvedValue(undefined),
    handleLemonSqueezyWebhook: jest.fn().mockResolvedValue(undefined),
    createCheckout: jest.fn().mockResolvedValue({ checkoutUrl: 'https://checkout.url' }),
    activateProInvite: jest.fn().mockResolvedValue(undefined),
    removeProInvite: jest.fn().mockResolvedValue(undefined),
    cancelSubscription: jest.fn().mockResolvedValue(undefined),
    handleRevenueCatWebhook: jest.fn().mockResolvedValue(undefined),
    syncRevenueCat: jest.fn().mockResolvedValue(undefined),
  };

  const mockUsersService = {
    findById: jest.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
  };

  // BillingMeResponse-shaped stub — only the fields we assert on matter here.
  // Full resolver behaviour is covered in effective-access.service.spec.ts.
  const mockEffective = {
    resolve: jest.fn().mockResolvedValue({
      effective: { plan: 'free', source: 'free', state: 'free', billingPeriod: null },
    }),
  };

  const futureTrialEnd = new Date(Date.now() + 7 * 86_400_000);
  const mockTrials = {
    activate: jest.fn().mockResolvedValue({
      id: 'trial-1',
      userId: 'user-1',
      plan: 'pro',
      source: 'backend',
      endsAt: futureTrialEnd,
      consumed: true,
    }),
    status: jest.fn().mockResolvedValue(null),
  };

  const req = { user: { id: 'user-1' } } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        { provide: BillingService, useValue: mockBillingService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: EffectiveAccessResolver, useValue: mockEffective },
        { provide: TrialsService, useValue: mockTrials },
      ],
    }).compile();

    controller = module.get<BillingController>(BillingController);
    jest.clearAllMocks();
  });

  it('should be defined', () => expect(controller).toBeDefined());

  it('webhook → verifies signature and handles event', async () => {
    const mockReq = { rawBody: '{}' } as any;
    const body = { meta: { event_name: 'order_created' }, data: {} };
    const result = await controller.webhook(mockReq, 'sig123', body);
    expect(mockBillingService.verifyWebhookSignature).toHaveBeenCalled();
    expect(mockBillingService.handleLemonSqueezyWebhook).toHaveBeenCalledWith(body);
    expect(result).toEqual({ received: true });
  });

  it('webhook → throws BadRequestException on invalid signature', async () => {
    mockBillingService.verifyWebhookSignature.mockReturnValueOnce(false);
    const mockReq = { rawBody: '{}' } as any;
    await expect(controller.webhook(mockReq, 'bad-sig', {})).rejects.toThrow(BadRequestException);
  });

  it('webhook → throws BadRequestException when rawBody missing', async () => {
    const mockReq = {} as any;
    await expect(controller.webhook(mockReq, 'sig', {})).rejects.toThrow(BadRequestException);
  });

  it('createCheckout → creates checkout with variantId', async () => {
    const dto = { variantId: 'var-1', billing: 'monthly' as const };
    const result = await controller.createCheckout(req, dto);
    expect(mockUsersService.findById).toHaveBeenCalledWith('user-1');
    expect(mockBillingService.createCheckout).toHaveBeenCalledWith('user-1', 'var-1', 'test@test.com', 'monthly');
    expect(result).toHaveProperty('checkoutUrl');
  });

  it('createCheckout → falls back to planId and monthly billing', async () => {
    const dto = { planId: 'plan-1' };
    await controller.createCheckout(req, dto);
    expect(mockBillingService.createCheckout).toHaveBeenCalledWith('user-1', 'plan-1', 'test@test.com', 'monthly');
  });

  it('createCheckout → uses empty string when no variantId/planId', async () => {
    await controller.createCheckout(req, {});
    expect(mockBillingService.createCheckout).toHaveBeenCalledWith('user-1', '', 'test@test.com', 'monthly');
  });

  it('getPlans → returns 3 plans', () => {
    const plans = controller.getPlans();
    expect(Array.isArray(plans)).toBe(true);
    expect(plans).toHaveLength(3);
    const ids = plans.map((p) => p.id);
    expect(ids).toContain('free');
    expect(ids).toContain('pro');
    expect(ids).toContain('organization');
  });

  it('getBillingMe → delegates to EffectiveAccessResolver', async () => {
    const result = await controller.getBillingMe(req);
    expect(mockEffective.resolve).toHaveBeenCalledWith('user-1');
    expect(result.effective.plan).toBe('free');
  });

  it('startTrial → delegates to TrialsService.activate with (userId, backend, pro)', async () => {
    const result = await controller.startTrial(req);
    expect(mockTrials.activate).toHaveBeenCalledWith('user-1', 'backend', 'pro');
    expect(result).toEqual({ success: true, endsAt: futureTrialEnd });
  });

  it('trialStatus → returns { trial: null } when user has no trial', async () => {
    mockTrials.status.mockResolvedValueOnce(null);
    const result = await controller.trialStatus(req);
    expect(mockTrials.status).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ trial: null });
  });

  it('trialStatus → returns the trial snapshot when present', async () => {
    const trial = {
      endsAt: futureTrialEnd,
      plan: 'pro',
      source: 'backend',
      consumed: true,
    };
    mockTrials.status.mockResolvedValueOnce(trial as any);
    const result = await controller.trialStatus(req);
    expect(result).toEqual({ trial });
  });

  it('invite → calls billingService.activateProInvite', async () => {
    const dto = { email: 'friend@test.com' } as any;
    const result = await controller.invite(req, dto);
    expect(mockBillingService.activateProInvite).toHaveBeenCalledWith('user-1', 'friend@test.com');
    expect(result).toHaveProperty('success', true);
  });

  it('removeInvite → calls billingService.removeProInvite', async () => {
    const result = await controller.removeInvite(req);
    expect(mockBillingService.removeProInvite).toHaveBeenCalledWith('user-1');
    expect(result).toHaveProperty('success', true);
  });

  it('cancelBilling → returns message', async () => {
    const result = await controller.cancelBilling({ user: { id: 'user-1' } });
    expect(result).toHaveProperty('message');
  });
});
