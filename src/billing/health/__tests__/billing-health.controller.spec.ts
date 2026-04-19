import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BillingHealthController } from '../billing-health.controller';
import { WebhookEvent } from '../../entities/webhook-event.entity';
import { OutboxService } from '../../outbox/outbox.service';

describe('BillingHealthController', () => {
  let controller: BillingHealthController;

  const mockWebhookRepo = {
    // Order of .count calls inside the controller: total first, failed second.
    count: jest
      .fn()
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(3),
  };

  const mockOutbox = {
    stats: jest.fn().mockResolvedValue({
      pending: 5,
      failed: 1,
      done24h: 42,
    }),
  };

  const makeModule = async (token: string | undefined) => {
    const mockCfg = {
      get: jest.fn((key: string) =>
        key === 'BILLING_HEALTH_TOKEN' ? token : undefined,
      ),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [BillingHealthController],
      providers: [
        { provide: getRepositoryToken(WebhookEvent), useValue: mockWebhookRepo },
        { provide: OutboxService, useValue: mockOutbox },
        { provide: ConfigService, useValue: mockCfg },
      ],
    }).compile();

    controller = moduleRef.get<BillingHealthController>(BillingHealthController);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockWebhookRepo.count = jest
      .fn()
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(3);
  });

  it('returns metrics when token matches', async () => {
    await makeModule('s3cret');
    const res = await controller.get('Bearer s3cret');
    expect(res).toEqual({
      webhookEvents24h: 100,
      webhookFailures24h: 3,
      webhookFailureRate: 0.03,
      outboxPending: 5,
      outboxFailed: 1,
    });
  });

  it('returns 0 failure rate when no events in 24h', async () => {
    mockWebhookRepo.count = jest
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    await makeModule('s3cret');
    const res = await controller.get('Bearer s3cret');
    expect(res.webhookFailureRate).toBe(0);
  });

  it('throws UnauthorizedException when authorization header is missing', async () => {
    await makeModule('s3cret');
    await expect(controller.get(undefined)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when token does not match', async () => {
    await makeModule('s3cret');
    await expect(controller.get('Bearer wrong')).rejects.toThrow(UnauthorizedException);
  });

  it('fails closed when BILLING_HEALTH_TOKEN is not configured', async () => {
    await makeModule(undefined);
    await expect(controller.get('Bearer anything')).rejects.toThrow(UnauthorizedException);
  });
});
