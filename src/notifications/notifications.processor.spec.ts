import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';

describe('NotificationsProcessor', () => {
  let processor: NotificationsProcessor;

  const mockService = {
    sendPushNotification: jest.fn().mockResolvedValue(undefined),
    sendBillingReminderEmail: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsProcessor,
        { provide: NotificationsService, useValue: mockService },
      ],
    }).compile();

    processor = module.get<NotificationsProcessor>(NotificationsProcessor);
    jest.clearAllMocks();
  });

  it('should be defined', () => expect(processor).toBeDefined());

  it('handleReminder sends push and email when fcmToken provided', async () => {
    const job = {
      data: {
        fcmToken: 'fcm-token',
        email: 'user@test.com',
        subscriptionName: 'Netflix',
        amount: 15,
        currency: 'USD',
        billingDate: '2024-12-25',
      },
    } as any;

    await processor.handleReminder(job);

    expect(mockService.sendPushNotification).toHaveBeenCalledWith(
      'fcm-token',
      '🔔 Upcoming Billing',
      'Netflix will be charged USD 15 on 2024-12-25',
      expect.any(Object),
    );
    expect(mockService.sendBillingReminderEmail).toHaveBeenCalledWith(
      'user@test.com',
      'Netflix',
      15,
      'USD',
      '2024-12-25',
    );
  });

  it('handleReminder sends only email when no fcmToken', async () => {
    const job = {
      data: {
        fcmToken: null,
        email: 'user@test.com',
        subscriptionName: 'Spotify',
        amount: 10,
        currency: 'USD',
        billingDate: '2024-12-20',
      },
    } as any;

    await processor.handleReminder(job);

    expect(mockService.sendPushNotification).not.toHaveBeenCalled();
    expect(mockService.sendBillingReminderEmail).toHaveBeenCalled();
  });

  it('handleReminder skips email when no email provided', async () => {
    const job = {
      data: {
        fcmToken: 'token',
        email: null,
        subscriptionName: 'Hulu',
        amount: 8,
        currency: 'USD',
        billingDate: '2024-12-22',
      },
    } as any;

    await processor.handleReminder(job);

    expect(mockService.sendPushNotification).toHaveBeenCalled();
    expect(mockService.sendBillingReminderEmail).not.toHaveBeenCalled();
  });

  it('handleReminder throws on error', async () => {
    mockService.sendPushNotification.mockRejectedValueOnce(new Error('FCM error'));
    const job = {
      data: {
        fcmToken: 'token',
        email: 'user@test.com',
        subscriptionName: 'Netflix',
        amount: 15,
        currency: 'USD',
        billingDate: '2024-12-25',
      },
    } as any;

    await expect(processor.handleReminder(job)).rejects.toThrow('FCM error');
  });
});
