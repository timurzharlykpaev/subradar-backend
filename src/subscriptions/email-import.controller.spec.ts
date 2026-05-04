import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { PayloadTooLargeException } from '@nestjs/common';
import { EmailImportController } from './email-import.controller';
import { SubscriptionsService } from './subscriptions.service';
import { AiService } from '../ai/ai.service';
import { UsersService } from '../users/users.service';
import { KnownBillingSender } from './email-import/known-billing-sender.entity';
import { RequireProGuard } from '../auth/guards/require-pro.guard';

describe('EmailImportController', () => {
  let controller: EmailImportController;

  const mockSubsService = {
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ name: 'Netflix', amount: 15 }),
  };

  const mockAiService = {
    parseEmailText: jest.fn().mockResolvedValue({ name: 'Netflix', amount: 15, currency: 'USD', billingPeriod: 'MONTHLY', category: 'ENTERTAINMENT' }),
    parseBulkSubscriptions: jest.fn().mockResolvedValue({ name: 'Netflix', amount: 15, currency: 'USD', billingPeriod: 'MONTHLY', category: 'ENTERTAINMENT' }),
    parseBulkEmails: jest.fn().mockResolvedValue([]),
  };

  const mockUsersService = {
    findById: jest.fn().mockResolvedValue({
      id: 'user-abc',
      email: 'user@test.com',
      gmailConnectedAt: null,
      gmailLastScanAt: null,
      gmailLastImportCount: null,
    }),
  };

  const mockSendersRepo = {
    find: jest.fn().mockResolvedValue([
      { domain: 'netflix.com', emailPattern: null, serviceName: 'Netflix', category: 'STREAMING', defaultCurrency: null },
    ]),
  };

  const mockUpdateBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const mockDataSource = {
    createQueryBuilder: jest.fn().mockReturnValue(mockUpdateBuilder),
  };

  const ORIG_TOKEN = process.env.EMAIL_IMPORT_TOKEN;
  beforeAll(() => { process.env.EMAIL_IMPORT_TOKEN = 'token'; });
  afterAll(() => {
    if (ORIG_TOKEN === undefined) delete process.env.EMAIL_IMPORT_TOKEN;
    else process.env.EMAIL_IMPORT_TOKEN = ORIG_TOKEN;
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailImportController],
      providers: [
        { provide: SubscriptionsService, useValue: mockSubsService },
        { provide: AiService, useValue: mockAiService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: getRepositoryToken(KnownBillingSender), useValue: mockSendersRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    })
      .overrideGuard(RequireProGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<EmailImportController>(EmailImportController);
    jest.clearAllMocks();
    mockSubsService.findAll.mockResolvedValue([]);
    mockSubsService.create.mockResolvedValue({ name: 'Netflix', amount: 15 });
    mockAiService.parseBulkSubscriptions.mockResolvedValue({ name: 'Netflix', amount: 15, currency: 'USD', billingPeriod: 'MONTHLY', category: 'ENTERTAINMENT' });
    mockAiService.parseBulkEmails.mockResolvedValue([]);
    mockUsersService.findById.mockResolvedValue({
      id: 'user-abc', email: 'user@test.com',
      gmailConnectedAt: null, gmailLastScanAt: null, gmailLastImportCount: null,
    });
    mockSendersRepo.find.mockResolvedValue([
      { domain: 'netflix.com', emailPattern: null, serviceName: 'Netflix', category: 'STREAMING', defaultCurrency: null },
    ]);
    mockDataSource.createQueryBuilder.mockReturnValue(mockUpdateBuilder);
  });

  it('should be defined', () => expect(controller).toBeDefined());

  // ── Existing forwarding flow (unchanged) ────────────────────────────────

  describe('handleInbound', () => {
    it('rejects requests without valid token', async () => {
      const r = await controller.handleInbound(
        { From: 'a@b.com', To: 'import+abc@subradar.ai', Subject: 'X', TextBody: 'subscription' },
        'wrong',
      );
      expect(r).toMatchObject({ ok: false, reason: 'invalid_token' });
    });

    it('rejects when To has no userId pattern', async () => {
      const r = await controller.handleInbound(
        { From: 'a@b.com', To: 'foo@subradar.ai', Subject: 'X', TextBody: 'subscription' },
        'token',
      );
      expect(r).toMatchObject({ ok: false, reason: 'no_user_id' });
    });

    it('rejects unknown user', async () => {
      mockUsersService.findById.mockResolvedValue(null);
      const r = await controller.handleInbound(
        { From: 'a@b.com', To: 'import+ghost@subradar.ai', Subject: 'X', TextBody: 'subscription' },
        'token',
      );
      expect(r).toMatchObject({ ok: false, reason: 'user_not_found' });
    });

    it('skips non-subscription emails', async () => {
      const r = await controller.handleInbound(
        { From: 'a@b.com', To: 'import+abc@subradar.ai', Subject: 'Hello', TextBody: 'hi friend' },
        'token',
      );
      expect(r).toMatchObject({ ok: false, reason: 'not_subscription_email' });
    });
  });

  // ── New Gmail scan endpoints ────────────────────────────────────────────

  describe('GET /known-senders', () => {
    it('returns active senders with public shape', async () => {
      const r = await controller.getKnownSenders();
      expect(r.senders).toHaveLength(1);
      expect(r.senders[0]).toMatchObject({
        domain: 'netflix.com',
        serviceName: 'Netflix',
        category: 'STREAMING',
      });
      expect(typeof r.updatedAt).toBe('string');
    });

    it('only fetches active rows', async () => {
      await controller.getKnownSenders();
      expect(mockSendersRepo.find).toHaveBeenCalledWith({ where: { active: true } });
    });
  });

  describe('POST /parse-bulk', () => {
    const baseDto = {
      messages: [
        { id: 'm1', subject: 'Netflix renewal', snippet: 'Renewed for $15.49',
          from: 'no-reply@netflix.com', receivedAt: '2026-03-14T10:00:00Z' },
      ],
      locale: 'en',
    };

    it('returns AI candidates filtered to recurring only', async () => {
      mockAiService.parseBulkEmails.mockResolvedValue([
        { sourceMessageId: 'm1', name: 'Netflix', amount: 15.49, currency: 'USD',
          billingPeriod: 'MONTHLY', category: 'STREAMING', status: 'ACTIVE',
          confidence: 0.95, isRecurring: true, isCancellation: false, isTrial: false,
          aggregatedFrom: ['m1'] },
        { sourceMessageId: 'm2', name: 'Movie', amount: 4.99, currency: 'USD',
          billingPeriod: 'ONE_TIME', category: 'OTHER', status: 'ACTIVE',
          confidence: 0.99, isRecurring: false, isCancellation: false, isTrial: false,
          aggregatedFrom: ['m2'] },
        { sourceMessageId: 'm3', name: 'Spotify', amount: 9.99, currency: 'USD',
          billingPeriod: 'MONTHLY', category: 'MUSIC', status: 'ACTIVE',
          confidence: 0.8, isRecurring: true, isCancellation: true, isTrial: false,
          aggregatedFrom: ['m3'] },
      ]);
      const r = await controller.parseBulk(baseDto, { user: { id: 'user-abc' } });
      expect(r.candidates).toHaveLength(1);
      expect(r.candidates[0].name).toBe('Netflix');
      expect(r.scannedCount).toBe(1);
    });

    it('throws 413 when more than 800 messages', async () => {
      const huge = {
        ...baseDto,
        messages: Array.from({ length: 801 }, (_, i) => ({
          id: `m${i}`, subject: 's', snippet: 's', from: 'a@b.com',
          receivedAt: '2026-03-14T10:00:00Z',
        })),
      };
      await expect(controller.parseBulk(huge, { user: { id: 'user-abc' } }))
        .rejects.toThrow(PayloadTooLargeException);
    });

    it('updates gmail_last_scan_at and seeds gmail_connected_at via COALESCE', async () => {
      await controller.parseBulk(baseDto, { user: { id: 'user-abc' } });
      expect(mockDataSource.createQueryBuilder).toHaveBeenCalled();
      expect(mockUpdateBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({
          gmailLastScanAt: expect.any(Function),
          gmailConnectedAt: expect.any(Function),
        }),
      );
      expect(mockUpdateBuilder.where).toHaveBeenCalledWith('id = :id', { id: 'user-abc' });
    });
  });

  describe('GET /status', () => {
    it('returns connection state from user fields', async () => {
      mockUsersService.findById.mockResolvedValue({
        id: 'user-abc',
        gmailConnectedAt: new Date('2026-04-01T00:00:00Z'),
        gmailLastScanAt: new Date('2026-04-15T12:00:00Z'),
        gmailLastImportCount: 7,
      });
      const r = await controller.getStatus({ user: { id: 'user-abc' } });
      expect(r).toEqual({
        gmailConnected: true,
        lastScanAt: '2026-04-15T12:00:00.000Z',
        lastImportCount: 7,
      });
    });

    it('returns disconnected state when never connected', async () => {
      const r = await controller.getStatus({ user: { id: 'user-abc' } });
      expect(r).toEqual({
        gmailConnected: false,
        lastScanAt: null,
        lastImportCount: null,
      });
    });
  });

  describe('POST /disconnect', () => {
    it('clears all gmail_* fields', async () => {
      const r = await controller.disconnect({ user: { id: 'user-abc' } });
      expect(r).toEqual({ ok: true });
      expect(mockUpdateBuilder.set).toHaveBeenCalledWith({
        gmailConnectedAt: null,
        gmailLastScanAt: null,
        gmailLastImportCount: null,
      });
    });
  });

  describe('POST /record-import', () => {
    it('clamps count to safe range (over)', async () => {
      await controller.recordImport({ count: 9999 }, { user: { id: 'user-abc' } });
      expect(mockUpdateBuilder.set).toHaveBeenCalledWith({ gmailLastImportCount: 800 });
    });

    it('clamps count to safe range (negative)', async () => {
      await controller.recordImport({ count: -5 }, { user: { id: 'user-abc' } });
      expect(mockUpdateBuilder.set).toHaveBeenCalledWith({ gmailLastImportCount: 0 });
    });

    it('coerces non-numeric input to 0', async () => {
      await controller.recordImport({ count: 'abc' as any }, { user: { id: 'user-abc' } });
      expect(mockUpdateBuilder.set).toHaveBeenCalledWith({ gmailLastImportCount: 0 });
    });
  });
});
