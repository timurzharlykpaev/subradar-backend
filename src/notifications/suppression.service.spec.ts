import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SuppressionService } from './suppression.service';
import { SuppressedEmail } from './entities/suppressed-email.entity';

describe('SuppressionService', () => {
  let service: SuppressionService;
  let findOne: jest.Mock;
  let del: jest.Mock;
  let execute: jest.Mock;
  let insertBuilder: any;

  beforeEach(async () => {
    findOne = jest.fn();
    del = jest.fn().mockResolvedValue({ affected: 1 });
    execute = jest.fn().mockResolvedValue(undefined);
    insertBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orUpdate: jest.fn().mockReturnThis(),
      execute,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppressionService,
        {
          provide: getRepositoryToken(SuppressedEmail),
          useValue: {
            findOne,
            delete: del,
            createQueryBuilder: jest.fn(() => insertBuilder),
          },
        },
      ],
    }).compile();

    service = module.get(SuppressionService);
  });

  describe('isSuppressed', () => {
    it('returns false for empty / blank / whitespace email', async () => {
      expect(await service.isSuppressed('')).toBe(false);
      expect(await service.isSuppressed('   ')).toBe(false);
      expect(await service.isSuppressed(undefined as any)).toBe(false);
      expect(findOne).not.toHaveBeenCalled();
    });

    it('normalises email to lowercase before lookup', async () => {
      findOne.mockResolvedValue(null);
      await service.isSuppressed('  Foo@BAR.com  ');
      expect(findOne).toHaveBeenCalledWith({ where: { email: 'foo@bar.com' } });
    });

    it('returns true when row is found', async () => {
      findOne.mockResolvedValue({ email: 'a@b.com' });
      expect(await service.isSuppressed('a@b.com')).toBe(true);
    });

    it('returns false when row is missing', async () => {
      findOne.mockResolvedValue(null);
      expect(await service.isSuppressed('a@b.com')).toBe(false);
    });
  });

  describe('suppress', () => {
    it('no-ops for empty email', async () => {
      await service.suppress('', 'hard_bounce');
      expect(execute).not.toHaveBeenCalled();
    });

    it('upserts a normalised row on hard_bounce', async () => {
      await service.suppress('  Foo@BAR.com ', 'hard_bounce', 'rc-ctx');
      expect(insertBuilder.values).toHaveBeenCalledWith({
        email: 'foo@bar.com',
        reason: 'hard_bounce',
        context: 'rc-ctx',
      });
      expect(insertBuilder.orUpdate).toHaveBeenCalledWith(
        ['reason', 'context'],
        ['email'],
      );
    });

    it('falls back context to null when not provided', async () => {
      await service.suppress('a@b.com', 'complaint');
      expect(insertBuilder.values).toHaveBeenCalledWith({
        email: 'a@b.com',
        reason: 'complaint',
        context: null,
      });
    });

    it('swallows DB errors (unique index race) without throwing', async () => {
      execute.mockRejectedValueOnce(new Error('duplicate key'));
      await expect(service.suppress('a@b.com', 'hard_bounce')).resolves.toBeUndefined();
    });
  });

  describe('unsuppress', () => {
    it('no-ops for empty email', async () => {
      await service.unsuppress('');
      expect(del).not.toHaveBeenCalled();
    });

    it('deletes by normalised email', async () => {
      await service.unsuppress(' A@B.com ');
      expect(del).toHaveBeenCalledWith({ email: 'a@b.com' });
    });
  });
});
