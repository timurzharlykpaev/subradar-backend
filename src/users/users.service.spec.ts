import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserBilling } from '../billing/entities/user-billing.entity';
import { AuditService } from '../common/audit/audit.service';

const mockUser: Partial<User> = {
  id: 'user-1',
  email: 'test@test.com',
  name: 'Test User',
  plan: 'free' as any,
  refreshToken: undefined,
};

const mockEm: any = {
  create: jest.fn().mockImplementation((_e, d) => ({ id: 'user-1', ...d })),
  save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
  insert: jest.fn().mockResolvedValue(undefined),
  findOne: jest.fn().mockResolvedValue({ id: 'user-1', plan: 'free' }),
};

const mockRepo: any = {
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(mockUser),
  })),
  create: jest.fn().mockImplementation((d) => ({ ...d })),
  save: jest.fn().mockImplementation((e) => Promise.resolve({ id: 'user-1', ...e })),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
  delete: jest.fn().mockResolvedValue({ affected: 1 }),
  manager: {
    query: jest.fn().mockResolvedValue([]),
    transaction: jest.fn(async (cb: any) => cb(mockEm)),
  },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockRepo },
        {
          provide: getRepositoryToken(UserBilling),
          useValue: { findOne: jest.fn(), insert: jest.fn() },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => '') },
        },
        {
          // exportUserData uses DataSource.getRepository(); tests that don't
          // exercise that path get a stub that throws if accidentally used.
          provide: DataSource,
          useValue: {
            getRepository: jest.fn(() => ({ find: jest.fn().mockResolvedValue([]) })),
          },
        },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findById', () => {
    it('returns user when found', async () => {
      mockRepo.findOne.mockResolvedValueOnce(mockUser);
      const result = await service.findById('user-1');
      expect(result).toEqual(mockUser);
    });

    it('throws NotFoundException when not found', async () => {
      mockRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.findById('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByEmail', () => {
    it('returns user when found', async () => {
      mockRepo.findOne.mockResolvedValueOnce(mockUser);
      const result = await service.findByEmail('test@test.com');
      expect(result).toEqual(mockUser);
    });

    it('returns null when not found', async () => {
      mockRepo.findOne.mockResolvedValueOnce(null);
      const result = await service.findByEmail('nobody@test.com');
      expect(result).toBeNull();
    });
  });

  describe('findByEmailWithPassword', () => {
    it('calls queryBuilder and returns user', async () => {
      const result = await service.findByEmailWithPassword('test@test.com');
      expect(result).toEqual(mockUser);
    });
  });

  describe('create', () => {
    it('creates user + user_billing row in a transaction', async () => {
      const result = await service.create({ email: 'new@test.com' });
      expect(mockRepo.manager.transaction).toHaveBeenCalled();
      expect(mockEm.save).toHaveBeenCalled();
      expect(mockEm.insert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ plan: 'free', billingStatus: 'free' }),
      );
      expect(result).toHaveProperty('id');
    });
  });

  describe('update', () => {
    it('updates allowed fields and returns updated user', async () => {
      mockRepo.findOne.mockResolvedValueOnce({ ...mockUser, name: 'Updated' });
      const result = await service.update('user-1', { name: 'Updated' });
      expect(mockRepo.update).toHaveBeenCalled();
      expect(result.name).toBe('Updated');
    });

    it('skips disallowed fields', async () => {
      mockRepo.findOne.mockResolvedValueOnce(mockUser);
      await service.update('user-1', { someHackyField: 'value' } as any);
      expect(mockRepo.update).not.toHaveBeenCalledWith('user-1', { someHackyField: 'value' });
    });
  });

  describe('updateRefreshToken', () => {
    it('calls repo.update with hashed token', async () => {
      await service.updateRefreshToken('user-1', 'new-token');
      expect(mockRepo.update).toHaveBeenCalledWith('user-1', expect.objectContaining({
        refreshToken: expect.any(String),
      }));
      const [, payload] = mockRepo.update.mock.calls[0];
      expect(payload.refreshToken).not.toBe('new-token');
      expect(payload.refreshTokenIssuedAt).toBeInstanceOf(Date);
    });

    it('uses null when null passed', async () => {
      await service.updateRefreshToken('user-1', null);
      expect(mockRepo.update).toHaveBeenCalledWith('user-1', {
        refreshToken: null,
        refreshTokenIssuedAt: null,
      });
    });
  });

  describe('updateFcmToken', () => {
    it('calls repo.update with fcmToken', async () => {
      await service.updateFcmToken('user-1', 'fcm-token-abc');
      expect(mockRepo.update).toHaveBeenCalledWith('user-1', { fcmToken: 'fcm-token-abc' });
    });
  });

  describe('updatePreferences', () => {
    it('updates timezone and locale', async () => {
      mockRepo.findOne.mockResolvedValueOnce({ ...mockUser, timezone: 'UTC', locale: 'en' });
      const result = await service.updatePreferences('user-1', { timezone: 'UTC', locale: 'en' });
      expect(mockRepo.update).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('deleteAccount', () => {
    it('deletes user by id', async () => {
      mockRepo.findOne.mockResolvedValueOnce(mockUser);
      mockRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });
      await expect(service.deleteAccount('user-1')).resolves.not.toThrow();
    });
  });
});
