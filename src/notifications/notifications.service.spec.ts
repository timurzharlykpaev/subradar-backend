import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bull';
import { NotificationsService } from './notifications.service';

jest.mock('firebase-admin', () => ({
  apps: [], initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  messaging: jest.fn(() => ({ send: jest.fn().mockResolvedValue('message-id') })),
}));

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ id: 'email-id' }) },
  })),
}));

const mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
const mockConfigService = {
  get: jest.fn((key: string, defaultVal?: string) => {
    if (key === 'RESEND_API_KEY') return 're_testkey';
    return defaultVal ?? '';
  }),
};

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getQueueToken('notifications'), useValue: mockQueue },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(service).toBeDefined(); });

  describe('scheduleReminderNotification', () => {
    it('adds job to queue', async () => {
      const jobData = { userId: 'u1', email: 'test@example.com', subscriptionName: 'Netflix', amount: 15, currency: 'USD', daysUntilBilling: 3, billingDate: '2024-12-01' };
      await service.scheduleReminderNotification(jobData);
      expect(mockQueue.add).toHaveBeenCalledWith('send-reminder', jobData, expect.any(Object));
    });
  });

  describe('sendUpcomingPaymentEmail', () => {
    it('calls sendEmail', async () => {
      const spy = jest.spyOn(service, 'sendEmail').mockResolvedValue(undefined as any);
      await service.sendUpcomingPaymentEmail('test@example.com', 'Netflix', 15, 'USD', 3, '2024-12-01', 'https://app.subradar.ai');
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('sendEmail', () => {
    it('sends email when resend configured', async () => {
      await expect(service.sendEmail('to@example.com', 'Test', '<p>Body</p>')).resolves.not.toThrow();
    });
  });
});
