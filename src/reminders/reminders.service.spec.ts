import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RemindersService } from './reminders.service';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';

const mockSubscriptionRepo = {
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  })),
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn().mockResolvedValue({}),
};

const mockUserRepo = {
  findOne: jest.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com', fcmToken: null, notificationsEnabled: true }),
  find: jest.fn().mockResolvedValue([]),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  })),
};

const mockNotificationsService = {
  scheduleReminderNotification: jest.fn().mockResolvedValue({}),
  sendEmail: jest.fn().mockResolvedValue({}),
};

describe('RemindersService', () => {
  let service: RemindersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemindersService,
        { provide: getRepositoryToken(Subscription), useValue: mockSubscriptionRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();
    service = module.get<RemindersService>(RemindersService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendDailyReminders', () => {
    it('runs without error when no subscriptions due', async () => {
      await expect(service.sendDailyReminders()).resolves.not.toThrow();
    });
  });

  describe('expireTrials', () => {
    it('runs without error', async () => {
      mockSubscriptionRepo.find.mockResolvedValueOnce([]);
      await expect(service.expireTrials()).resolves.not.toThrow();
    });
  });
});
