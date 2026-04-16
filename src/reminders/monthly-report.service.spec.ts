import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MonthlyReportService } from './monthly-report.service';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramAlertService } from '../common/telegram-alert.service';

const mockSubRepo = {
  find: jest.fn().mockResolvedValue([]),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  })),
};

const mockUserRepo = {
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
};

const mockNotifications = {
  sendEmail: jest.fn().mockResolvedValue({}),
};

describe('MonthlyReportService', () => {
  let service: MonthlyReportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonthlyReportService,
        { provide: getRepositoryToken(Subscription), useValue: mockSubRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: TelegramAlertService, useValue: { send: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get<MonthlyReportService>(MonthlyReportService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendMonthlyReports', () => {
    it('runs without error when no users', async () => {
      mockUserRepo.find.mockResolvedValueOnce([]);
      await expect(service.sendMonthlyReports()).resolves.not.toThrow();
    });
  });
});
