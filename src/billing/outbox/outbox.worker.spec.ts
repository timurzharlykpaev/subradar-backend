import { Test, TestingModule } from '@nestjs/testing';
import { OutboxWorker, exponentialBackoff } from './outbox.worker';
import { OutboxService } from './outbox.service';
import { AmplitudeHandler } from './handlers/amplitude.handler';
import { TelegramHandler } from './handlers/telegram.handler';
import { FcmHandler } from './handlers/fcm.handler';

describe('exponentialBackoff', () => {
  it('grows as 2^attempts seconds from now', () => {
    const base = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(base);
    expect(exponentialBackoff(1).getTime() - base).toBe(2_000);
    expect(exponentialBackoff(3).getTime() - base).toBe(8_000);
    expect(exponentialBackoff(10).getTime() - base).toBe(1_024_000);
    (Date.now as jest.Mock).mockRestore();
  });

  it('caps at 1 hour', () => {
    const base = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(base);
    expect(exponentialBackoff(12).getTime() - base).toBe(3_600_000);
    expect(exponentialBackoff(20).getTime() - base).toBe(3_600_000);
    (Date.now as jest.Mock).mockRestore();
  });
});

describe('OutboxWorker', () => {
  let worker: OutboxWorker;
  let outbox: { claimBatch: jest.Mock; markDone: jest.Mock; markFailed: jest.Mock };
  let amplitude: { handle: jest.Mock };
  let telegram: { handle: jest.Mock };
  let fcm: { handle: jest.Mock };

  beforeEach(async () => {
    outbox = {
      claimBatch: jest.fn().mockResolvedValue([]),
      markDone: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    amplitude = { handle: jest.fn().mockResolvedValue(undefined) };
    telegram = { handle: jest.fn().mockResolvedValue(undefined) };
    fcm = { handle: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxWorker,
        { provide: OutboxService, useValue: outbox },
        { provide: AmplitudeHandler, useValue: amplitude },
        { provide: TelegramHandler, useValue: telegram },
        { provide: FcmHandler, useValue: fcm },
      ],
    }).compile();
    worker = module.get(OutboxWorker);
  });

  function event(overrides: Partial<any> = {}): any {
    return {
      id: 'evt-1',
      type: 'amplitude.track',
      payload: { event: 'foo' },
      attempts: 0,
      ...overrides,
    };
  }

  it('does nothing when batch is empty', async () => {
    await worker.tick();
    expect(amplitude.handle).not.toHaveBeenCalled();
    expect(outbox.markDone).not.toHaveBeenCalled();
  });

  it('dispatches amplitude.track events and marks them done', async () => {
    outbox.claimBatch.mockResolvedValue([event()]);
    await worker.tick();
    expect(amplitude.handle).toHaveBeenCalledWith({ event: 'foo' });
    expect(outbox.markDone).toHaveBeenCalledWith('evt-1');
    expect(outbox.markFailed).not.toHaveBeenCalled();
  });

  it('dispatches telegram.alert and fcm.push independently', async () => {
    outbox.claimBatch.mockResolvedValue([
      event({ id: 't-1', type: 'telegram.alert', payload: { text: 'hi' } }),
      event({ id: 'f-1', type: 'fcm.push', payload: { token: 't' } }),
    ]);
    await worker.tick();
    expect(telegram.handle).toHaveBeenCalledWith({ text: 'hi' });
    expect(fcm.handle).toHaveBeenCalledWith({ token: 't' });
    expect(outbox.markDone).toHaveBeenCalledTimes(2);
  });

  it('on handler failure increments attempts and schedules next retry', async () => {
    amplitude.handle.mockRejectedValueOnce(new Error('boom'));
    outbox.claimBatch.mockResolvedValue([event({ attempts: 2 })]);
    await worker.tick();
    expect(outbox.markFailed).toHaveBeenCalledTimes(1);
    const [id, message, attempts, next] = outbox.markFailed.mock.calls[0];
    expect(id).toBe('evt-1');
    expect(message).toBe('boom');
    expect(attempts).toBe(3);
    expect(next).toBeInstanceOf(Date);
  });

  it('moves event to failed terminal after MAX_ATTEMPTS (10)', async () => {
    amplitude.handle.mockRejectedValueOnce(new Error('still bad'));
    outbox.claimBatch.mockResolvedValue([event({ attempts: 9 })]);
    await worker.tick();
    const [, , attempts, next] = outbox.markFailed.mock.calls[0];
    expect(attempts).toBe(10);
    expect(next).toBeNull();
  });

  it('fails immediately on unknown event type (no retries)', async () => {
    outbox.claimBatch.mockResolvedValue([event({ type: 'unknown.x' as any })]);
    await worker.tick();
    expect(outbox.markFailed).toHaveBeenCalledTimes(1);
    const [, message] = outbox.markFailed.mock.calls[0];
    expect(message).toMatch(/Unknown outbox event type/);
  });

  it('isolates per-event failures — one failure does not block others', async () => {
    amplitude.handle.mockRejectedValueOnce(new Error('fail 1'));
    outbox.claimBatch.mockResolvedValue([
      event({ id: 'a' }),
      event({ id: 'b', type: 'telegram.alert' }),
      event({ id: 'c', type: 'fcm.push' }),
    ]);
    await worker.tick();
    expect(outbox.markFailed).toHaveBeenCalledTimes(1);
    expect(outbox.markFailed.mock.calls[0][0]).toBe('a');
    expect(outbox.markDone).toHaveBeenCalledWith('b');
    expect(outbox.markDone).toHaveBeenCalledWith('c');
  });

  it('bails out cleanly when claimBatch throws (DB outage)', async () => {
    outbox.claimBatch.mockRejectedValueOnce(new Error('db down'));
    await expect(worker.tick()).resolves.toBeUndefined();
    expect(outbox.markDone).not.toHaveBeenCalled();
    expect(outbox.markFailed).not.toHaveBeenCalled();
  });
});
