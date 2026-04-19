import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { TrialsService } from '../trials.service';
import { UserTrial } from '../entities/user-trial.entity';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../outbox/outbox.service';

describe('TrialsService', () => {
  let svc: TrialsService;
  let manager: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let ds: { transaction: jest.Mock };
  let trialRepo: { findOne: jest.Mock };
  let audit: { log: jest.Mock };
  let outbox: { enqueue: jest.Mock };

  beforeEach(async () => {
    manager = {
      findOne: jest.fn(),
      // passthrough — we only assert on the shape of the object that
      // reaches save(), not that `create()` materialised an entity class.
      create: jest.fn((_entity, data) => data),
      save: jest.fn(async (x) => ({ ...x, id: 'trial-1' })),
    };
    ds = {
      transaction: jest.fn(async (cb: any) => cb(manager)),
    };
    trialRepo = { findOne: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    outbox = { enqueue: jest.fn().mockResolvedValue({ id: 'evt-1' }) };

    const mod = await Test.createTestingModule({
      providers: [
        TrialsService,
        { provide: getDataSourceToken(), useValue: ds },
        { provide: getRepositoryToken(UserTrial), useValue: trialRepo },
        { provide: AuditService, useValue: audit },
        { provide: OutboxService, useValue: outbox },
      ],
    }).compile();

    svc = mod.get(TrialsService);
  });

  describe('activate', () => {
    it('throws ConflictException when trial exists', async () => {
      manager.findOne.mockResolvedValueOnce({ id: 'existing' }); // UserTrial row

      await expect(svc.activate('u1', 'backend', 'pro')).rejects.toThrow(
        ConflictException,
      );
      expect(manager.save).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user missing', async () => {
      manager.findOne
        .mockResolvedValueOnce(null) // UserTrial
        .mockResolvedValueOnce(null); // User

      await expect(svc.activate('u1', 'backend', 'pro')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects backend trial for user already on paid plan', async () => {
      manager.findOne
        .mockResolvedValueOnce(null) // UserTrial
        .mockResolvedValueOnce({ id: 'u1', plan: 'pro' }); // User

      await expect(svc.activate('u1', 'backend', 'pro')).rejects.toThrow(
        /paid plan/i,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('activates when no existing trial (backend source, free user)', async () => {
      manager.findOne
        .mockResolvedValueOnce(null) // UserTrial
        .mockResolvedValueOnce({ id: 'u1', plan: 'free' }); // User

      const t = await svc.activate('u1', 'backend', 'pro');

      expect(t.id).toBe('trial-1');
      expect(t.source).toBe('backend');
      expect(t.plan).toBe('pro');
      expect(t.consumed).toBe(true);
      expect(t.originalTransactionId).toBeNull();
      // endsAt should be ~7 days past startedAt
      const dtMs = t.endsAt.getTime() - t.startedAt.getTime();
      expect(dtMs).toBe(7 * 86_400_000);

      // pessimistic write lock requested
      expect(manager.findOne).toHaveBeenNthCalledWith(
        1,
        UserTrial,
        expect.objectContaining({
          lock: { mode: 'pessimistic_write' },
        }),
      );

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          action: 'billing.trial_activated',
          resourceType: 'user_trial',
          resourceId: 'trial-1',
          metadata: { source: 'backend', plan: 'pro' },
        }),
      );
      expect(outbox.enqueue).toHaveBeenCalledWith(
        'amplitude.track',
        expect.objectContaining({
          event: 'billing.trial_started',
          userId: 'u1',
          properties: { source: 'backend', plan: 'pro' },
        }),
        manager, // transactional enqueue
      );
    });

    it('allows RC intro trial even for non-free user, stores originalTxId', async () => {
      manager.findOne
        .mockResolvedValueOnce(null) // UserTrial
        .mockResolvedValueOnce({ id: 'u1', plan: 'pro' }); // User — paid, but RC source is fine

      const t = await svc.activate(
        'u1',
        'revenuecat_intro',
        'pro',
        'orig-tx-42',
      );

      expect(t.source).toBe('revenuecat_intro');
      expect(t.originalTransactionId).toBe('orig-tx-42');
    });
  });

  describe('status', () => {
    it('returns the trial row for the user', async () => {
      trialRepo.findOne.mockResolvedValueOnce({ id: 't', userId: 'u1' });
      const res = await svc.status('u1');
      expect(res).toEqual({ id: 't', userId: 'u1' });
      expect(trialRepo.findOne).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
    });

    it('returns null when no trial exists', async () => {
      trialRepo.findOne.mockResolvedValueOnce(null);
      const res = await svc.status('u1');
      expect(res).toBeNull();
    });
  });
});
