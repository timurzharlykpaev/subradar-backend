import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BillingService } from './billing.service';
import { UsersService } from '../users/users.service';
import { Workspace } from '../workspace/entities/workspace.entity';
import { WorkspaceMember } from '../workspace/entities/workspace-member.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { TelegramAlertService } from '../common/telegram-alert.service';
import { AuditService } from '../common/audit/audit.service';
import { OutboxService } from './outbox/outbox.service';
import { TrialsService } from './trials/trials.service';
import { UserBillingRepository } from './user-billing.repository';

const mockUsersService = {
  findById: jest.fn(), findByEmail: jest.fn(), update: jest.fn(), save: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string, defaultVal?: string) => defaultVal ?? ''),
};

const mockWorkspaceRepo = {
  findOne: jest.fn().mockResolvedValue(null),
  save: jest.fn(),
};

const mockWorkspaceMemberRepo = {
  findOne: jest.fn().mockResolvedValue(null),
  find: jest.fn().mockResolvedValue([]),
};

const mockWebhookEventRepo = {
  insert: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
  update: jest.fn().mockResolvedValue(undefined),
};

const mockManager = {
  findOne: jest.fn().mockResolvedValue(null),
  update: jest.fn().mockResolvedValue(undefined),
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn().mockResolvedValue(undefined),
};

const mockDataSource = {
  transaction: jest.fn(async (cb: any) => cb(mockManager)),
};

const mockTelegramAlert = {
  send: jest.fn().mockResolvedValue(true),
};

const mockUser = {
  id: 'user-1', email: 'test@example.com', plan: 'free', trialUsed: false,
  trialEndDate: null, proInviteeEmail: null, aiRequestsUsed: 0, aiRequestsMonth: null,
};

describe('BillingService', () => {
  let service: BillingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: getRepositoryToken(Workspace), useValue: mockWorkspaceRepo },
        { provide: getRepositoryToken(WorkspaceMember), useValue: mockWorkspaceMemberRepo },
        { provide: getRepositoryToken(WebhookEvent), useValue: mockWebhookEventRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TelegramAlertService, useValue: mockTelegramAlert },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: OutboxService, useValue: { enqueue: jest.fn().mockResolvedValue(undefined) } },
        { provide: TrialsService, useValue: { activate: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: UserBillingRepository,
          useValue: {
            read: jest.fn().mockResolvedValue({
              userId: 'user-1', plan: 'free', state: 'free', billingSource: null,
              billingPeriod: null, currentPeriodStart: null, currentPeriodEnd: null,
              cancelAtPeriodEnd: false, graceExpiresAt: null, graceReason: null, billingIssueAt: null,
            }),
            applyTransition: jest.fn().mockResolvedValue({
              applied: true, from: 'free', to: 'active',
              snapshot: {
                userId: 'user-1', plan: 'pro', state: 'active', billingSource: 'lemon_squeezy',
                billingPeriod: 'monthly', currentPeriodStart: null, currentPeriodEnd: null,
                cancelAtPeriodEnd: false, graceExpiresAt: null, graceReason: null, billingIssueAt: null,
              },
            }),
          },
        },
      ],
    }).compile();
    service = module.get<BillingService>(BillingService);
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(service).toBeDefined(); });

  // NOTE: startTrial + getBillingInfo were removed from BillingService in
  // Phase 10 of the subscription refactor. /billing/me → EffectiveAccessResolver,
  // /billing/trial → TrialsService.activate. Controller-level coverage lives
  // in billing.controller.spec.ts; service-level coverage for trials lives
  // in trials/__tests__/trials.service.spec.ts.

  describe('handleWebhook', () => {
    it('upgrades user to pro on subscription_created (via state machine)', async () => {
      mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, plan: 'free', billingStatus: 'free' });
      const userBilling = (service as any).userBilling;
      await service.handleWebhook('subscription_created', {
        attributes: {
          user_email: 'test@example.com',
          status: 'active',
          variant_id: '874616',
          customer_id: 'cust-1',
        },
      });
      expect(userBilling.applyTransition).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: 'LS_SUBSCRIPTION_CREATED', plan: 'pro' }),
        expect.objectContaining({ actor: 'webhook_ls' }),
      );
    });
    it('downgrades user on subscription_cancelled (via state machine)', async () => {
      mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, plan: 'pro', billingStatus: 'active' });
      const userBilling = (service as any).userBilling;
      userBilling.applyTransition.mockResolvedValueOnce({
        applied: true, from: 'active', to: 'free',
        snapshot: {
          userId: 'user-1', plan: 'free', state: 'free', billingSource: null,
          billingPeriod: null, currentPeriodStart: null, currentPeriodEnd: null,
          cancelAtPeriodEnd: false, graceExpiresAt: null, graceReason: null, billingIssueAt: null,
        },
      });
      await service.handleWebhook('subscription_cancelled', {
        attributes: { user_email: 'test@example.com' },
      });
      expect(userBilling.applyTransition).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: 'LS_SUBSCRIPTION_CANCELLED' }),
        expect.objectContaining({ actor: 'webhook_ls' }),
      );
    });
    it('handles order_created without error', async () => {
      await expect(service.handleWebhook('order_created', { id: 'order-1' })).resolves.toBeUndefined();
    });
    it('handles unknown event gracefully', async () => {
      await expect(service.handleWebhook('unknown_event', {})).resolves.not.toThrow();
    });
  });

  describe('consumeAiRequest', () => {
    it('increments ai requests', async () => {
      const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      mockUsersService.findById.mockResolvedValue({ ...mockUser, plan: 'pro', billingSource: 'revenuecat', cancelAtPeriodEnd: false, aiRequestsUsed: 5, aiRequestsMonth: currentMonth });
      mockUsersService.update.mockResolvedValue(undefined);
      await service.consumeAiRequest('user-1');
      expect(mockUsersService.update).toHaveBeenCalledWith('user-1', expect.objectContaining({ aiRequestsUsed: 6 }));
    });
    it('throws ForbiddenException when limit reached', async () => {
      const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      mockUsersService.findById.mockResolvedValue({ ...mockUser, plan: 'free', aiRequestsUsed: 10, aiRequestsMonth: currentMonth });
      await expect(service.consumeAiRequest('user-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('verifies correct HMAC signature', () => {
      const { createHmac } = require('crypto');
      const secret = 'test-secret';
      const svc = new BillingService(
        { get: () => secret } as any,
        mockUsersService as any,
        mockWorkspaceRepo as any,
        mockWorkspaceMemberRepo as any,
        mockWebhookEventRepo as any,
        mockDataSource as any,
        mockTelegramAlert as any,
        { log: jest.fn() } as any, // AuditService stub
        { enqueue: jest.fn() } as any, // OutboxService stub
        { activate: jest.fn() } as any, // TrialsService stub
        { read: jest.fn(), applyTransition: jest.fn() } as any, // UserBillingRepository stub
      );
      const payload = 'test-payload';
      const sig = createHmac('sha256', secret).update(payload).digest('hex');
      expect(svc.verifyWebhookSignature(payload, sig)).toBe(true);
    });
  });

  describe('resolveVariantId', () => {
    it('returns numeric id directly', () => {
      expect(service.resolveVariantId('12345')).toBe('12345');
    });
    it('resolves pro plan to variant id', () => {
      const variantId = service.resolveVariantId('pro');
      expect(typeof variantId).toBe('string');
    });
  });
});
