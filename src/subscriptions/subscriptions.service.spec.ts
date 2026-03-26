import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { Subscription, BillingPeriod, SubscriptionStatus } from './entities/subscription.entity';
import { UsersService } from '../users/users.service';

const mockRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
  })),
};

const mockUsersService = {
  findById: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue(undefined),
};

const mockSub = {
  id: 'sub-1',
  userId: 'user-1',
  name: 'Netflix',
  amount: 15,
  currency: 'USD',
  billingPeriod: BillingPeriod.MONTHLY,
  status: SubscriptionStatus.ACTIVE,
  startDate: new Date('2024-01-01'),
};

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: getRepositoryToken(Subscription), useValue: mockRepo },
        { provide: UsersService, useValue: mockUsersService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all subscriptions for user', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
        getMany: jest.fn().mockResolvedValue([mockSub]),
        getOne: jest.fn().mockResolvedValue(null),
      };
      mockRepo.createQueryBuilder.mockReturnValue(qb);
      const result = await service.findAll('user-1');
      expect(result).toEqual([mockSub]);
    });
  });

  describe('findOne', () => {
    it('should return subscription', async () => {
      mockRepo.findOne.mockResolvedValue(mockSub);
      const result = await service.findOne('user-1', 'sub-1');
      expect(result).toEqual(mockSub);
    });

    it('should throw NotFoundException when not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('user-1', 'sub-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when userId does not match', async () => {
      mockRepo.findOne.mockResolvedValue({ ...mockSub, userId: 'other-user' });
      await expect(service.findOne('user-1', 'sub-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('create', () => {
    it('should create and return subscription for pro plan', async () => {
      mockUsersService.findById.mockResolvedValue({ plan: 'pro' });
      const dto = { name: 'Netflix', amount: 15, currency: 'USD', billingPeriod: BillingPeriod.MONTHLY, startDate: new Date('2024-01-01') };
      mockRepo.create.mockReturnValue({ ...mockSub, ...dto });
      mockRepo.save.mockResolvedValue({ ...mockSub, ...dto });
      const result = await service.create('user-1', dto as any);
      expect(result).toEqual(expect.objectContaining({ name: 'Netflix' }));
    });

    it('should throw ForbiddenException when free plan limit reached', async () => {
      mockUsersService.findById.mockResolvedValue({ plan: 'free' });
      mockRepo.count.mockResolvedValue(3);
      await expect(service.create('user-1', {} as any)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('should update and return subscription', async () => {
      mockRepo.findOne.mockResolvedValue({ ...mockSub });
      mockRepo.save.mockResolvedValue({ ...mockSub, name: 'Updated' });
      const result = await service.update('user-1', 'sub-1', { name: 'Updated' } as any);
      expect(result.name).toBe('Updated');
    });
  });

  describe('remove', () => {
    it('should remove subscription', async () => {
      mockRepo.findOne.mockResolvedValue(mockSub);
      mockRepo.remove.mockResolvedValue(undefined);
      await expect(service.remove('user-1', 'sub-1')).resolves.toBeUndefined();
    });
  });

  describe('countActive', () => {
    it('should return count of active subscriptions', async () => {
      mockRepo.count.mockResolvedValue(3);
      const result = await service.countActive('user-1');
      expect(result).toBe(3);
    });
  });

  describe('findAllForUser', () => {
    it('should return subscriptions without relations', async () => {
      mockRepo.find.mockResolvedValue([mockSub]);
      const result = await service.findAllForUser('user-1');
      expect(result).toEqual([mockSub]);
    });
  });
});
