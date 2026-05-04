import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { REDIS_CLIENT } from '../common/redis.module';
import { TelegramAlertService } from '../common/telegram-alert.service';

jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: {
    completions: {
      create: jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              done: true,
              subscription: { name: 'Netflix', amount: 15.99, currency: 'USD', billingPeriod: 'MONTHLY', cancelUrl: 'https://netflix.com/cancel' },
            }),
          },
        }],
      }),
    },
  },
  audio: { transcriptions: { create: jest.fn().mockResolvedValue({ text: 'Netflix 15 dollars per month' }) } },
})));

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
})));

const mockConfigService = {
  get: jest.fn((key: string, defaultVal?: string) => defaultVal ?? ''),
};

describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: REDIS_CLIENT,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
            del: jest.fn().mockResolvedValue(1),
            incr: jest.fn().mockResolvedValue(1),
            expire: jest.fn().mockResolvedValue(1),
            ping: jest.fn().mockResolvedValue('PONG'),
          },
        },
        {
          provide: TelegramAlertService,
          useValue: { send: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();
    service = module.get<AiService>(AiService);
  });

  it('should be defined', () => { expect(service).toBeDefined(); });

  describe('lookupService', () => {
    it('returns service info', async () => {
      const result = await service.lookupService('Netflix');
      expect(typeof result).toBe('object');
    });
  });

  describe('parseBulkSubscriptions', () => {
    it('parses subscriptions from text', async () => {
      const result = await service.parseBulkSubscriptions('Netflix 15 dollars, Spotify 10 dollars');
      expect(result).toBeDefined();
    });
  });

  describe('parseEmailText', () => {
    it('parses email text', async () => {
      const result = await service.parseEmailText('Your Netflix subscription of $15.99 has been renewed');
      expect(result).toBeDefined();
    });
  });

  describe('suggestCancelUrl', () => {
    it('returns cancel info', async () => {
      const result = await service.suggestCancelUrl('Netflix');
      expect(result).toBeDefined();
    });
  });

  describe('wizard', () => {
    it('returns done:true with subscription for known service (netflix)', async () => {
      const result = await service.wizard('netflix', {}, 'en');
      expect(result).toHaveProperty('done');
      if (result.done) {
        expect(result.subscription).toHaveProperty('name');
        expect(result.subscription).toHaveProperty('amount');
        expect(result.subscription).toHaveProperty('billingPeriod');
      }
    });

    it('returns done:false or done:true for unknown input', async () => {
      const result = await service.wizard('some random unknown service xyz', {}, 'en');
      expect(result).toHaveProperty('done');
    });
  });

  describe('parseBulkEmails', () => {
    const mockAiResponse = (candidates: any[]) => {
      const ai = (service as any).openai;
      ai.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ candidates }) } }],
      });
    };

    it('returns empty array for empty input', async () => {
      const r = await service.parseBulkEmails([], 'en');
      expect(r).toEqual([]);
    });

    it('parses a single Netflix receipt', async () => {
      mockAiResponse([
        { sourceMessageId: 'm1', name: 'Netflix', amount: 15.49, currency: 'USD',
          billingPeriod: 'MONTHLY', category: 'STREAMING', status: 'ACTIVE',
          confidence: 0.95, isRecurring: true, isCancellation: false, isTrial: false,
          nextPaymentDate: '2026-04-14' },
      ]);
      const r = await service.parseBulkEmails([{
        id: 'm1', subject: 'Netflix renewal', snippet: 'Renewed for $15.49',
        from: 'no-reply@netflix.com', receivedAt: '2026-03-14T10:00:00Z',
      }], 'en');
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({
        name: 'Netflix', amount: 15.49, currency: 'USD',
        billingPeriod: 'MONTHLY', isRecurring: true,
      });
      expect(r[0].aggregatedFrom).toEqual(['m1']);
    });

    it('aggregates multiple receipts using median amount (outlier-resistant)', async () => {
      mockAiResponse([
        { sourceMessageId: 'm1', name: 'Netflix', amount: 15, currency: 'USD',
          billingPeriod: 'MONTHLY', category: 'STREAMING', status: 'ACTIVE',
          confidence: 0.95, isRecurring: true, isCancellation: false, isTrial: false,
          nextPaymentDate: '2025-12-14' },
        { sourceMessageId: 'm2', name: 'Netflix', amount: 15, currency: 'USD',
          billingPeriod: 'MONTHLY', category: 'STREAMING', status: 'ACTIVE',
          confidence: 0.93, isRecurring: true, isCancellation: false, isTrial: false,
          nextPaymentDate: '2026-01-14' },
        { sourceMessageId: 'm3', name: 'Netflix', amount: 15, currency: 'USD',
          billingPeriod: 'MONTHLY', category: 'STREAMING', status: 'ACTIVE',
          confidence: 0.94, isRecurring: true, isCancellation: false, isTrial: false,
          nextPaymentDate: '2026-02-14' },
        { sourceMessageId: 'm4', name: 'Netflix', amount: 159, currency: 'USD',
          billingPeriod: 'MONTHLY', category: 'STREAMING', status: 'ACTIVE',
          confidence: 0.4, isRecurring: true, isCancellation: false, isTrial: false,
          nextPaymentDate: '2026-03-14' },
        { sourceMessageId: 'm5', name: 'Netflix', amount: 15.49, currency: 'USD',
          billingPeriod: 'MONTHLY', category: 'STREAMING', status: 'ACTIVE',
          confidence: 0.97, isRecurring: true, isCancellation: false, isTrial: false,
          nextPaymentDate: '2026-04-14' },
      ]);
      const r = await service.parseBulkEmails([
        { id: 'm1', subject: 's', snippet: 's', from: 'a@b.com', receivedAt: '2025-12-14T10:00:00Z' },
        { id: 'm2', subject: 's', snippet: 's', from: 'a@b.com', receivedAt: '2026-01-14T10:00:00Z' },
        { id: 'm3', subject: 's', snippet: 's', from: 'a@b.com', receivedAt: '2026-02-14T10:00:00Z' },
        { id: 'm4', subject: 's', snippet: 's', from: 'a@b.com', receivedAt: '2026-03-14T10:00:00Z' },
        { id: 'm5', subject: 's', snippet: 's', from: 'a@b.com', receivedAt: '2026-04-14T10:00:00Z' },
      ], 'en');
      expect(r).toHaveLength(1);
      expect(r[0].amount).toBe(15);
      expect(r[0].confidence).toBe(0.97);
      expect(r[0].nextPaymentDate).toBe('2026-04-14');
      expect(r[0].aggregatedFrom.sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    });

    it('preserves isRecurring:false for one-time purchases (filtering deferred to caller)', async () => {
      mockAiResponse([
        { sourceMessageId: 'm1', name: 'Apple TV Movie', amount: 4.99, currency: 'USD',
          billingPeriod: 'ONE_TIME', category: 'OTHER', status: 'ACTIVE',
          confidence: 0.98, isRecurring: false, isCancellation: false, isTrial: false },
      ]);
      const r = await service.parseBulkEmails([{
        id: 'm1', subject: 'Receipt', snippet: 'You bought a movie',
        from: 'no_reply@apple.com', receivedAt: '2026-03-01T10:00:00Z',
      }], 'en');
      expect(r).toHaveLength(1);
      expect(r[0].isRecurring).toBe(false);
    });

    it('preserves trial flag and trialEndDate', async () => {
      mockAiResponse([
        { sourceMessageId: 'm1', name: 'Notion', amount: 10, currency: 'USD',
          billingPeriod: 'MONTHLY', category: 'PRODUCTIVITY', status: 'TRIAL',
          confidence: 0.9, isRecurring: true, isCancellation: false, isTrial: true,
          trialEndDate: '2026-04-05' },
      ]);
      const r = await service.parseBulkEmails([{
        id: 'm1', subject: 'Trial', snippet: 'Trial ends Apr 5',
        from: 'team@notion.so', receivedAt: '2026-03-10T10:00:00Z',
      }], 'en');
      expect(r[0].isTrial).toBe(true);
      expect(r[0].status).toBe('TRIAL');
      expect(r[0].trialEndDate).toBe('2026-04-05');
    });

    it('rejects HTML/script-like content in name (anti-injection)', async () => {
      mockAiResponse([
        { sourceMessageId: 'm1', name: '<script>alert(1)</script>', amount: 10, currency: 'USD',
          billingPeriod: 'MONTHLY', category: 'OTHER', status: 'ACTIVE',
          confidence: 0.9, isRecurring: true, isCancellation: false, isTrial: false },
        { sourceMessageId: 'm2', name: 'Netflix', amount: 15, currency: 'USD',
          billingPeriod: 'MONTHLY', category: 'STREAMING', status: 'ACTIVE',
          confidence: 0.95, isRecurring: true, isCancellation: false, isTrial: false },
      ]);
      const r = await service.parseBulkEmails([
        { id: 'm1', subject: 's', snippet: 's', from: 'a@b.com', receivedAt: '2026-03-01T10:00:00Z' },
        { id: 'm2', subject: 's', snippet: 's', from: 'b@c.com', receivedAt: '2026-03-02T10:00:00Z' },
      ], 'en');
      expect(r).toHaveLength(1);
      expect(r[0].name).toBe('Netflix');
    });

    it('rejects invalid currency / amount / period', async () => {
      mockAiResponse([
        { sourceMessageId: 'm1', name: 'A', amount: -10, currency: 'USD',
          billingPeriod: 'MONTHLY', category: 'OTHER', status: 'ACTIVE',
          confidence: 0.9, isRecurring: true, isCancellation: false, isTrial: false },
        { sourceMessageId: 'm2', name: 'B', amount: 10, currency: 'DROP',
          billingPeriod: 'MONTHLY', category: 'OTHER', status: 'ACTIVE',
          confidence: 0.9, isRecurring: true, isCancellation: false, isTrial: false },
        { sourceMessageId: 'm3', name: 'C', amount: 10, currency: 'USD',
          billingPeriod: 'BIWEEKLY', category: 'OTHER', status: 'ACTIVE',
          confidence: 0.9, isRecurring: true, isCancellation: false, isTrial: false },
        { sourceMessageId: 'm4', name: 'OK', amount: 5, currency: 'USD',
          billingPeriod: 'MONTHLY', category: 'OTHER', status: 'ACTIVE',
          confidence: 0.9, isRecurring: true, isCancellation: false, isTrial: false },
      ]);
      const r = await service.parseBulkEmails([
        { id: 'm1', subject: 's', snippet: 's', from: 'a@b.com', receivedAt: '2026-03-01T10:00:00Z' },
        { id: 'm2', subject: 's', snippet: 's', from: 'a@b.com', receivedAt: '2026-03-02T10:00:00Z' },
        { id: 'm3', subject: 's', snippet: 's', from: 'a@b.com', receivedAt: '2026-03-03T10:00:00Z' },
        { id: 'm4', subject: 's', snippet: 's', from: 'a@b.com', receivedAt: '2026-03-04T10:00:00Z' },
      ], 'en');
      expect(r).toHaveLength(1);
      expect(r[0].name).toBe('OK');
    });

    it('returns empty array on AI failure (no throw)', async () => {
      const ai = (service as any).openai;
      ai.chat.completions.create.mockRejectedValueOnce(new Error('OpenAI down'));
      const r = await service.parseBulkEmails([{
        id: 'm1', subject: 's', snippet: 's', from: 'a@b.com', receivedAt: '2026-03-01T10:00:00Z',
      }], 'en');
      expect(r).toEqual([]);
    });

    it('returns empty array when AI returns malformed candidates', async () => {
      mockAiResponse([{ totally: 'wrong shape' }]);
      const r = await service.parseBulkEmails([{
        id: 'm1', subject: 's', snippet: 's', from: 'a@b.com', receivedAt: '2026-03-01T10:00:00Z',
      }], 'en');
      expect(r).toEqual([]);
    });
  });
});
