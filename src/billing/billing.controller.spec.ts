import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { UsersService } from '../users/users.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';

describe('BillingController', () => {
  let controller: BillingController;

  const mockBillingService = {
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    handleWebhook: jest.fn().mockResolvedValue(undefined),
    createCheckout: jest.fn().mockResolvedValue({ checkoutUrl: 'https://checkout.url' }),
    getBillingInfo: jest.fn().mockResolvedValue({ plan: 'free', aiRequestsLeft: 10 }),
    startTrial: jest.fn().mockResolvedValue(undefined),
    activateProInvite: jest.fn().mockResolvedValue(undefined),
    removeProInvite: jest.fn().mockResolvedValue(undefined),
    cancelSubscription: jest.fn().mockResolvedValue(undefined),
    handleRevenueCatWebhook: jest.fn().mockResolvedValue(undefined),
    syncRevenueCat: jest.fn().mockResolvedValue(undefined),
  };

  const mockUsersService = {
    findById: jest.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
  };

  const mockSubscriptionsService = {
    findAll: jest.fn().mockResolvedValue([
      { status: SubscriptionStatus.ACTIVE },
      { status: SubscriptionStatus.TRIAL },
      { status: 'cancelled' },
    ]),
  };

  const req = { user: { id: 'user-1' } } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        { provide: BillingService, useValue: mockBillingService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: SubscriptionsService, useValue: mockSubscriptionsService },
      ],
    }).compile();

    controller = module.get<BillingController>(BillingController);
    jest.clearAllMocks();
  });

  it('should be defined', () => expect(controller).toBeDefined());

  it('webhook → verifies signature and handles event', async () => {
    const mockReq = { rawBody: Buffer.from('{}') } as any;
    const body = { meta: { event_name: 'order_created' }, data: {} };
    const result = await controller.webhook(mockReq, 'sig123', body);
    expect(mockBillingService.verifyWebhookSignature).toHaveBeenCalled();
    expect(mockBillingService.handleWebhook).toHaveBeenCalledWith('order_created', {});
    expect(result).toEqual({ received: true });
  });

  it('webhook → throws BadRequestException on invalid signature', async () => {
    mockBillingService.verifyWebhookSignature.mockReturnValueOnce(false);
    const mockReq = { rawBody: Buffer.from('{}') } as any;
    await expect(controller.webhook(mockReq, 'bad-sig', {})).rejects.toThrow(BadRequestException);
  });

  it('webhook → handles missing rawBody by stringifying body', async () => {
    const mockReq = {} as any;
    const body = { meta: { event_name: 'test' }, data: {} };
    await controller.webhook(mockReq, 'sig', body);
    expect(mockBillingService.verifyWebhookSignature).toHaveBeenCalled();
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

  it('getBillingMe → counts active+trial subs and calls getBillingInfo', async () => {
    const result = await controller.getBillingMe(req);
    expect(mockSubscriptionsService.findAll).toHaveBeenCalledWith('user-1');
    expect(mockBillingService.getBillingInfo).toHaveBeenCalledWith('user-1', 2);
    expect(result).toHaveProperty('plan');
  });

  it('startTrial → calls billingService.startTrial', async () => {
    const result = await controller.startTrial(req);
    expect(mockBillingService.startTrial).toHaveBeenCalledWith('user-1');
    expect(result).toHaveProperty('success', true);
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
