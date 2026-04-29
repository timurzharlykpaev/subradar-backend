import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';

import { BillingService } from '../billing.service';
import { UsersService } from '../../users/users.service';
import { Workspace } from '../../workspace/entities/workspace.entity';
import { WorkspaceMember } from '../../workspace/entities/workspace-member.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { TelegramAlertService } from '../../common/telegram-alert.service';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { TrialsService } from '../trials/trials.service';
import { UserBillingRepository } from '../user-billing.repository';

/**
 * Integration-style unit test for webhook idempotency.
 *
 * The contract under test:
 *   - `claimWebhookEvent(provider, eventId)` inserts a row in
 *     `webhook_events`. On the FIRST call it returns `true`.
 *   - On the SECOND call with the same `(provider, eventId)` pair the
 *     Postgres unique constraint fires (`QueryFailedError` with code 23505).
 *     The service must catch it and return `false` so handlers short-circuit
 *     and return `{ duplicate: true }` without re-processing.
 *
 * We can't bring up Postgres in unit tests, so we simulate the unique-
 * violation error by having the mocked repo's `insert` throw a
 * `QueryFailedError` with `code: '23505'` on the second call.
 *
 * Full-path e2e coverage (real HTTP → DB) is intentionally skipped here:
 * `AppModule` requires Postgres + Redis + RevenueCat, so it belongs in the
 * `test/integration/` suite gated on `RUN_INTEGRATION=1`.
 */

function makeUniqueViolation(): QueryFailedError {
  const err = new QueryFailedError(
    'INSERT INTO webhook_events ...',
    [],
    new Error('duplicate key value violates unique constraint "UQ_webhook_events_provider_event_id"'),
  );
  // Typeorm surfaces the underlying pg error via `.code` on the QueryFailedError.
  (err as unknown as { code: string }).code = '23505';
  return err;
}

describe('BillingService.claimWebhookEvent (idempotency)', () => {
  let service: BillingService;
  let webhookEventRepo: { insert: jest.Mock };

  beforeEach(async () => {
    webhookEventRepo = {
      insert: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn(),
            findByEmail: jest.fn(),
            update: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_: string, def?: string) => def ?? '') },
        },
        { provide: getRepositoryToken(Workspace), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(WorkspaceMember), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(WebhookEvent), useValue: webhookEventRepo },
        {
          provide: getDataSourceToken(),
          useValue: { transaction: jest.fn(async (cb: any) => cb({})) },
        },
        { provide: TelegramAlertService, useValue: { send: jest.fn() } },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: OutboxService, useValue: { enqueue: jest.fn() } },
        { provide: TrialsService, useValue: { activate: jest.fn() } },
        {
          provide: UserBillingRepository,
          useValue: { read: jest.fn(), applyTransition: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
  });

  it('returns true on first insert (new event)', async () => {
    webhookEventRepo.insert.mockResolvedValueOnce(undefined);

    const result = await service.claimWebhookEvent('revenuecat', 'evt_unique_1');

    expect(result).toBe(true);
    expect(webhookEventRepo.insert).toHaveBeenCalledWith({
      provider: 'revenuecat',
      eventId: 'evt_unique_1',
      eventType: null,
    });
  });

  it('returns false on second insert with the same (provider, eventId) — duplicate', async () => {
    // First delivery: succeeds.
    webhookEventRepo.insert.mockResolvedValueOnce(undefined);
    // Second delivery: Postgres rejects with unique-constraint violation.
    webhookEventRepo.insert.mockRejectedValueOnce(makeUniqueViolation());

    const first = await service.claimWebhookEvent('revenuecat', 'evt_dup_1');
    const second = await service.claimWebhookEvent('revenuecat', 'evt_dup_1');

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(webhookEventRepo.insert).toHaveBeenCalledTimes(2);
  });

  it('dedupes per (provider, eventId) — same eventId across providers is not a duplicate', async () => {
    webhookEventRepo.insert.mockResolvedValue(undefined);

    const rc = await service.claimWebhookEvent('revenuecat', 'evt_shared');
    const ls = await service.claimWebhookEvent('lemon_squeezy', 'evt_shared');

    expect(rc).toBe(true);
    expect(ls).toBe(true);
    expect(webhookEventRepo.insert).toHaveBeenNthCalledWith(1, {
      provider: 'revenuecat',
      eventId: 'evt_shared',
      eventType: null,
    });
    expect(webhookEventRepo.insert).toHaveBeenNthCalledWith(2, {
      provider: 'lemon_squeezy',
      eventId: 'evt_shared',
      eventType: null,
    });
  });

  it('lets unknown DB errors bubble up (never swallowed as duplicate)', async () => {
    const fatal = new QueryFailedError('INSERT ...', [], new Error('connection refused'));
    (fatal as unknown as { code: string }).code = '08006'; // connection failure
    webhookEventRepo.insert.mockRejectedValueOnce(fatal);

    await expect(
      service.claimWebhookEvent('revenuecat', 'evt_fatal'),
    ).rejects.toBe(fatal);
  });

  it('when eventId is missing, lets the handler run (downstream ops must be idempotent)', async () => {
    const result = await service.claimWebhookEvent('revenuecat', '');

    expect(result).toBe(true);
    // No INSERT attempted — the handler is allowed to proceed and rely on
    // the idempotency of the individual operations it performs.
    expect(webhookEventRepo.insert).not.toHaveBeenCalled();
  });
});
