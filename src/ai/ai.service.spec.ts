import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';

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
});
