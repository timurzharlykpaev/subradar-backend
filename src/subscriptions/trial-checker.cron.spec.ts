import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TrialCheckerCron } from './trial-checker.cron';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramAlertService } from '../common/telegram-alert.service';

describe('TrialCheckerCron', () => {
  let cron: TrialCheckerCron;

  const mockSubRepo = { find: jest.fn() };
  const mockUserRepo = { findOne: jest.fn() };
  const mockNotifications = {
    sendPushNotification: jest.fn().mockResolvedValue(undefined),
    sendEmail: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrialCheckerCron,
        { provide: getRepositoryToken(Subscription), useValue: mockSubRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: TelegramAlertService, useValue: { send: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    cron = module.get<TrialCheckerCron>(TrialCheckerCron);
    jest.clearAllMocks();
  });

  it('should be defined', () => expect(cron).toBeDefined());

  it('does nothing when no trials found', async () => {
    mockSubRepo.find.mockResolvedValue([]);
    await cron.checkExpiringTrials();
    expect(mockNotifications.sendEmail).not.toHaveBeenCalled();
    expect(mockNotifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it('skips trial without trialEndDate', async () => {
    mockSubRepo.find.mockResolvedValue([
      { id: 'sub-1', name: 'Netflix', status: SubscriptionStatus.TRIAL, trialEndDate: null, userId: 'u1' },
    ]);
    await cron.checkExpiringTrials();
    expect(mockNotifications.sendEmail).not.toHaveBeenCalled();
  });

  it('skips trial when reminder days do not match', async () => {
    const trialEndDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days
    mockSubRepo.find.mockResolvedValue([
      {
        id: 'sub-1',
        name: 'Netflix',
        status: SubscriptionStatus.TRIAL,
        trialEndDate,
        userId: 'u1',
        reminderDaysBefore: [1, 3],
        reminderEnabled: true,
      },
    ]);
    await cron.checkExpiringTrials();
    expect(mockNotifications.sendEmail).not.toHaveBeenCalled();
  });

  it('sends reminder when daysLeft matches reminderDaysBefore', async () => {
    const trialEndDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 - 1000); // ~3 days
    const user = { id: 'u1', email: 'user@test.com', fcmToken: 'fcm-token' };
    mockSubRepo.find.mockResolvedValue([
      {
        id: 'sub-1',
        name: 'Netflix',
        status: SubscriptionStatus.TRIAL,
        trialEndDate,
        userId: 'u1',
        reminderDaysBefore: [1, 3],
        reminderEnabled: true,
        currency: 'USD',
        amount: 15,
        cancelUrl: 'https://cancel.netflix.com',
      },
    ]);
    mockUserRepo.findOne.mockResolvedValue(user);

    await cron.checkExpiringTrials();

    expect(mockNotifications.sendPushNotification).toHaveBeenCalledWith(
      'fcm-token',
      'Trial Ending Soon',
      expect.stringContaining('Netflix'),
      expect.objectContaining({ subscriptionId: 'sub-1', type: 'trial_expiring' }),
    );
    expect(mockNotifications.sendEmail).toHaveBeenCalledWith(
      'user@test.com',
      expect.stringContaining('Netflix'),
      expect.stringContaining('Netflix'),
    );
  });

  it('sends reminder for 1 day left with "tomorrow" message', async () => {
    const trialEndDate = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000 - 1000); // ~1 day
    const user = { id: 'u1', email: 'user@test.com', fcmToken: null };
    mockSubRepo.find.mockResolvedValue([
      {
        id: 'sub-1',
        name: 'Spotify',
        status: SubscriptionStatus.TRIAL,
        trialEndDate,
        userId: 'u1',
        reminderDaysBefore: [1, 3],
        reminderEnabled: true,
        currency: 'USD',
        amount: 10,
        cancelUrl: null,
      },
    ]);
    mockUserRepo.findOne.mockResolvedValue(user);

    await cron.checkExpiringTrials();

    expect(mockNotifications.sendEmail).toHaveBeenCalledWith(
      'user@test.com',
      expect.any(String),
      expect.stringContaining('tomorrow'),
    );
    expect(mockNotifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it('skips when user not found', async () => {
    const trialEndDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 - 1000);
    mockSubRepo.find.mockResolvedValue([
      {
        id: 'sub-1',
        name: 'Netflix',
        status: SubscriptionStatus.TRIAL,
        trialEndDate,
        userId: 'u1',
        reminderDaysBefore: [1, 3],
        reminderEnabled: true,
      },
    ]);
    mockUserRepo.findOne.mockResolvedValue(null);

    await cron.checkExpiringTrials();
    expect(mockNotifications.sendEmail).not.toHaveBeenCalled();
  });

  it('skips when reminderEnabled is false', async () => {
    const trialEndDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 - 1000);
    mockSubRepo.find.mockResolvedValue([
      {
        id: 'sub-1',
        name: 'Netflix',
        status: SubscriptionStatus.TRIAL,
        trialEndDate,
        userId: 'u1',
        reminderEnabled: false,
      },
    ]);

    await cron.checkExpiringTrials();
    expect(mockNotifications.sendEmail).not.toHaveBeenCalled();
  });

  it('handles error in notification gracefully', async () => {
    const trialEndDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 - 1000);
    const user = { id: 'u1', email: 'user@test.com', fcmToken: null };
    mockSubRepo.find.mockResolvedValue([
      {
        id: 'sub-1',
        name: 'Netflix',
        status: SubscriptionStatus.TRIAL,
        trialEndDate,
        userId: 'u1',
        reminderDaysBefore: [3],
        reminderEnabled: true,
        currency: 'USD',
        amount: 15,
      },
    ]);
    mockUserRepo.findOne.mockResolvedValue(user);
    mockNotifications.sendEmail.mockRejectedValueOnce(new Error('SMTP error'));

    // Should not throw
    await expect(cron.checkExpiringTrials()).resolves.not.toThrow();
  });
});
