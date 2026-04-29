import { ConflictException } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

describe('IdempotencyService', () => {
  const buildSvc = () => {
    const rows: any[] = [];
    const repo: any = {
      findOne: jest.fn(({ where }) =>
        rows.find(
          (r) =>
            r.userId === where.userId &&
            r.endpoint === where.endpoint &&
            r.key === where.key,
        ) ?? null,
      ),
      insert: jest.fn(async (row) => {
        const dup = rows.find(
          (r) =>
            r.userId === row.userId &&
            r.endpoint === row.endpoint &&
            r.key === row.key,
        );
        if (dup) {
          const e: any = new Error('duplicate');
          e.code = '23505';
          throw e;
        }
        rows.push({ ...row, createdAt: new Date() });
      }),
      delete: jest.fn(async (where) => {
        const idx = rows.findIndex(
          (r) =>
            r.userId === where.userId &&
            r.endpoint === where.endpoint &&
            r.key === where.key,
        );
        if (idx >= 0) rows.splice(idx, 1);
      }),
    };
    return { svc: new IdempotencyService(repo), repo, rows };
  };

  it('first call: runs handler, caches response, returns it', async () => {
    const { svc } = buildSvc();
    const handler = jest.fn().mockResolvedValue({ statusCode: 200, body: { ok: true } });

    const r = await svc.run('u-1', 'billing.cancel', 'key-1', null, handler);

    expect(r.cached).toBe(false);
    expect(r.body).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('replay with same key + same body: returns cached, does not re-run handler', async () => {
    const { svc } = buildSvc();
    const handler = jest.fn().mockResolvedValue({ statusCode: 200, body: { ok: true } });

    await svc.run('u-1', 'billing.cancel', 'key-1', { x: 1 }, handler);
    const second = await svc.run('u-1', 'billing.cancel', 'key-1', { x: 1 }, handler);

    expect(second.cached).toBe(true);
    expect(second.body).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('replay with same key + DIFFERENT body: throws 409', async () => {
    const { svc } = buildSvc();
    const handler = jest.fn().mockResolvedValue({ statusCode: 200, body: { ok: true } });

    await svc.run('u-1', 'billing.cancel', 'key-1', { x: 1 }, handler);

    await expect(
      svc.run('u-1', 'billing.cancel', 'key-1', { x: 2 }, handler),
    ).rejects.toThrow(ConflictException);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('different keys for same user: each runs the handler', async () => {
    const { svc } = buildSvc();
    const handler = jest.fn().mockResolvedValue({ statusCode: 200, body: { ok: true } });

    await svc.run('u-1', 'billing.cancel', 'key-A', null, handler);
    await svc.run('u-1', 'billing.cancel', 'key-B', null, handler);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('different users: same key is independent', async () => {
    const { svc } = buildSvc();
    const handler = jest.fn().mockResolvedValue({ statusCode: 200, body: { ok: true } });

    await svc.run('u-1', 'billing.cancel', 'key-1', null, handler);
    await svc.run('u-2', 'billing.cancel', 'key-1', null, handler);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('23505 race: loser reads winner row and returns winner response', async () => {
    // Simulates two concurrent first-time calls. Both findOne return
    // null (race). Both enter the handler. Winner inserts first.
    // Loser's insert raises 23505; loser must catch + re-fetch and
    // return the winner's body.
    const rows: any[] = [];
    const winnerBody = { winner: true };
    const loserBody = { winner: false };
    let firstFindOneSeesIt = false;
    const repo: any = {
      findOne: jest.fn(({ where }) => {
        if (!firstFindOneSeesIt) {
          firstFindOneSeesIt = true;
          return null; // both initial findOnes see no row
        }
        return rows.find(
          (r) =>
            r.userId === where.userId &&
            r.endpoint === where.endpoint &&
            r.key === where.key,
        ) ?? null;
      }),
      insert: jest
        .fn()
        .mockImplementationOnce(async (row) => {
          rows.push({ ...row, createdAt: new Date() });
        })
        .mockImplementationOnce(async () => {
          const e: any = new Error('duplicate');
          e.code = '23505';
          throw e;
        }),
      delete: jest.fn(),
    };
    const svc = new IdempotencyService(repo);

    const winner = await svc.run('u-1', 'billing.cancel', 'k', null, async () => ({
      statusCode: 200,
      body: winnerBody,
    }));
    const loser = await svc.run('u-1', 'billing.cancel', 'k', null, async () => ({
      statusCode: 200,
      body: loserBody,
    }));

    expect(winner.cached).toBe(false);
    expect(winner.body).toEqual(winnerBody);
    // Loser caught 23505, refetched, returned winner's body.
    expect(loser.cached).toBe(true);
    expect(loser.body).toEqual(winnerBody);
  });

  it('expired row (>24h): treats as first call again', async () => {
    const { svc, rows } = buildSvc();
    const handler = jest.fn().mockResolvedValue({ statusCode: 200, body: { v: 1 } });

    await svc.run('u-1', 'billing.cancel', 'key-1', null, handler);
    // Backdate the row to 25h ago.
    rows[0].createdAt = new Date(Date.now() - 25 * 3_600_000);

    const second = await svc.run(
      'u-1',
      'billing.cancel',
      'key-1',
      null,
      jest.fn().mockResolvedValue({ statusCode: 200, body: { v: 2 } }),
    );
    expect(second.cached).toBe(false);
    expect(second.body).toEqual({ v: 2 });
  });
});
