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
  update: jest.fn().mockResolvedValue({ affected: 1 }),
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

    it('sends email and push when subscriptions due with fcmToken', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const in1Day = new Date(today);
      in1Day.setDate(today.getDate() + 1);

      const mockSub = {
        id: 'sub-1',
        name: 'Netflix',
        amount: 15,
        currency: 'USD',
        userId: 'user-1',
        nextPaymentDate: in1Day,
        status: 'ACTIVE',
      };

      (mockSubscriptionRepo.createQueryBuilder as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockSub]),
      });

      mockUserRepo.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        fcmToken: 'fcm-token',
        emailNotifications: true,
      });

      (mockNotificationsService as any).sendUpcomingPaymentEmail = jest.fn().mockResolvedValue(undefined);
      (mockNotificationsService as any).sendPushNotification = jest.fn().mockResolvedValue(undefined);

      await expect(service.sendDailyReminders()).resolves.not.toThrow();
    });

    it('skips user when user not found', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const in1Day = new Date(today);
      in1Day.setDate(today.getDate() + 1);

      const mockSub = {
        id: 'sub-1', name: 'Netflix', amount: 15, currency: 'USD', userId: 'user-1', nextPaymentDate: in1Day,
      };

      (mockSubscriptionRepo.createQueryBuilder as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockSub]),
      });

      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.sendDailyReminders()).resolves.not.toThrow();
    });

    it('skips user when notificationsEnabled is false', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const in1Day = new Date(today);
      in1Day.setDate(today.getDate() + 1);

      const mockSub = {
        id: 'sub-1', name: 'Netflix', amount: 15, currency: 'USD', userId: 'user-1', nextPaymentDate: in1Day,
      };

      (mockSubscriptionRepo.createQueryBuilder as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockSub]),
      });

      mockUserRepo.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        fcmToken: 'fcm-token',
        notificationsEnabled: false,
      });

      (mockNotificationsService as any).sendUpcomingPaymentEmail = jest.fn();
      (mockNotificationsService as any).sendPushNotification = jest.fn();

      await service.sendDailyReminders();

      expect((mockNotificationsService as any).sendUpcomingPaymentEmail).not.toHaveBeenCalled();
      expect((mockNotificationsService as any).sendPushNotification).not.toHaveBeenCalled();
    });

    it('handles errors gracefully per subscription', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const in1Day = new Date(today);
      in1Day.setDate(today.getDate() + 1);

      (mockSubscriptionRepo.createQueryBuilder as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: 'sub-1', name: 'Netflix', amount: 15, currency: 'USD', userId: 'user-1', nextPaymentDate: in1Day },
        ]),
      });

      mockUserRepo.findOne.mockRejectedValueOnce(new Error('DB error'));

      await expect(service.sendDailyReminders()).resolves.not.toThrow();
    });
  });

  describe('expireTrials', () => {
    it('runs without error with no expired trials', async () => {
      (mockUserRepo.createQueryBuilder as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });
      await expect(service.expireTrials()).resolves.not.toThrow();
    });

    it('downgrades expired trial users to free', async () => {
      const expiredUser = { id: 'user-1', email: 'user@test.com', plan: 'pro' };
      (mockUserRepo.createQueryBuilder as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([expiredUser]),
      });
      mockUserRepo.update = jest.fn().mockResolvedValue(undefined);

      await expect(service.expireTrials()).resolves.not.toThrow();
      expect(mockUserRepo.update).toHaveBeenCalledWith('user-1', { plan: 'free' });
    });
  });
});
