import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OutboxService } from '../outbox.service';
import { OutboxEvent } from '../entities/outbox-event.entity';

describe('OutboxService', () => {
  let service: OutboxService;
  let repo: jest.Mocked<Pick<Repository<OutboxEvent>, 'create' | 'save' | 'update' | 'count'>> & {
    manager: { query: jest.Mock };
  };

  beforeEach(async () => {
    repo = {
      create: jest.fn((x) => x as OutboxEvent),
      save: jest.fn(async (x) => ({ ...(x as object), id: 'generated' }) as OutboxEvent),
      update: jest.fn(async () => ({ affected: 1 }) as any),
      count: jest.fn(async () => 0),
      manager: { query: jest.fn(async () => [{ c: 0 }]) },
    } as any;

    const mod = await Test.createTestingModule({
      providers: [
        OutboxService,
        { provide: getRepositoryToken(OutboxEvent), useValue: repo },
      ],
    }).compile();

    service = mod.get(OutboxService);
  });

  describe('enqueue', () => {
    it('creates a pending event with attempts=0', async () => {
      await service.enqueue('amplitude.track', { event: 'test', userId: 'u1' });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'amplitude.track',
          payload: { event: 'test', userId: 'u1' },
          status: 'pending',
          attempts: 0,
        }),
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'amplitude.track',
          status: 'pending',
        }),
      );
    });

    it('uses the provided transaction manager when given', async () => {
      const manager = { save: jest.fn(async (_cls, x) => ({ ...x, id: 'tx' })) } as any;
      await service.enqueue('telegram.alert', { text: 'hi' }, manager);

      expect(manager.save).toHaveBeenCalledTimes(1);
      // repo.save must NOT be called when a manager is supplied — otherwise
      // the enqueue would escape the caller's transaction.
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('markDone', () => {
    it('flips status to done and stamps processedAt', async () => {
      await service.markDone('event-1');

      expect(repo.update).toHaveBeenCalledWith(
        'event-1',
        expect.objectContaining({ status: 'done', lastError: null }),
      );
      const patch = repo.update.mock.calls[0][1] as any;
      expect(patch.processedAt).toBeInstanceOf(Date);
    });
  });

  describe('markFailed', () => {
    it('keeps status pending when a retry time is given', async () => {
      const next = new Date(Date.now() + 60_000);
      await service.markFailed('ev-1', 'boom', 2, next);

      expect(repo.update).toHaveBeenCalledWith(
        'ev-1',
        expect.objectContaining({
          status: 'pending',
          attempts: 2,
          lastError: 'boom',
          nextAttemptAt: next,
          processedAt: null,
        }),
      );
    });

    it('moves to failed when nextAttemptAt is null (retries exhausted)', async () => {
      await service.markFailed('ev-2', 'kaput', 10, null);

      const patch = repo.update.mock.calls[0][1] as any;
      expect(patch.status).toBe('failed');
      expect(patch.attempts).toBe(10);
      expect(patch.processedAt).toBeInstanceOf(Date);
    });

    it('truncates long error messages to 2000 chars', async () => {
      const long = 'x'.repeat(5000);
      await service.markFailed('ev-3', long, 1, new Date());
      const patch = repo.update.mock.calls[0][1] as any;
      expect(patch.lastError.length).toBe(2000);
    });
  });
});
