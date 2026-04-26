import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { Report, ReportType, ReportStatus } from './entities/report.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { PaymentCard } from '../payment-cards/entities/payment-card.entity';
import { User } from '../users/entities/user.entity';
import { REDIS_CLIENT } from '../common/redis.module';
import { FxService } from '../fx/fx.service';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  }));
});

jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => {
    const callbacks: Record<string, (...args: any[]) => void> = {};
    const doc = {
      on: jest.fn((event: string, cb: (...args: any[]) => void) => { callbacks[event] = cb; }),
      end: jest.fn(() => {
        if (callbacks['data']) callbacks['data'](Buffer.from('pdf'));
        if (callbacks['end']) callbacks['end']();
      }),
      pipe: jest.fn().mockReturnThis(),
      fontSize: jest.fn().mockReturnThis(),
      font: jest.fn().mockReturnThis(),
      text: jest.fn().mockReturnThis(),
      moveDown: jest.fn().mockReturnThis(),
      moveTo: jest.fn().mockReturnThis(),
      lineTo: jest.fn().mockReturnThis(),
      stroke: jest.fn().mockReturnThis(),
      lineWidth: jest.fn().mockReturnThis(),
      strokeColor: jest.fn().mockReturnThis(),
      fillColor: jest.fn().mockReturnThis(),
      rect: jest.fn().mockReturnThis(),
      fill: jest.fn().mockReturnThis(),
      fillAndStroke: jest.fn().mockReturnThis(),
      circle: jest.fn().mockReturnThis(),
      image: jest.fn().mockReturnThis(),
      addPage: jest.fn().mockReturnThis(),
      opacity: jest.fn().mockReturnThis(),
      dash: jest.fn().mockReturnThis(),
      undash: jest.fn().mockReturnThis(),
      save: jest.fn().mockReturnThis(),
      restore: jest.fn().mockReturnThis(),
      registerFont: jest.fn().mockReturnThis(),
      bufferedPageRange: jest.fn(() => ({ start: 0, count: 1 })),
      switchToPage: jest.fn().mockReturnThis(),
      flushPages: jest.fn().mockReturnThis(),
      fillOpacity: jest.fn().mockReturnThis(),
      y: 100,
    };
    return doc;
  });
});

const mockReportRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  remove: jest.fn(),
  update: jest.fn(),
  count: jest.fn().mockResolvedValue(0),
};
const mockSubRepo = { find: jest.fn() };
const mockCardRepo = { find: jest.fn() };
const mockUserRepo = { findOne: jest.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com', plan: 'pro' }) };
const mockQueue = { add: jest.fn().mockResolvedValue({}) };

const mockReport = {
  id: 'rep-1',
  userId: 'user-1',
  status: ReportStatus.READY,
  type: ReportType.SUMMARY,
  from: '2024-01-01',
  to: '2024-01-31',
};

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getRepositoryToken(Report), useValue: mockReportRepo },
        { provide: getRepositoryToken(Subscription), useValue: mockSubRepo },
        { provide: getRepositoryToken(PaymentCard), useValue: mockCardRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getQueueToken('reports'), useValue: mockQueue },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
        {
          provide: REDIS_CLIENT,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
            del: jest.fn().mockResolvedValue(1),
            incr: jest.fn().mockResolvedValue(1),
            expire: jest.fn().mockResolvedValue(1),
            ping: jest.fn().mockResolvedValue('PONG'),
          },
        },
        {
          provide: FxService,
          useValue: {
            getRates: jest.fn().mockResolvedValue({
              base: 'USD',
              rates: { USD: 1, EUR: 0.92, RUB: 90, KZT: 480, GBP: 0.79 },
              fetchedAt: new Date(),
              source: 'mock',
            }),
            convert: jest.fn((amount, from, to, rates) => {
              if (from === to) return amount;
              const fromRate = from === 'USD' ? 1 : rates[from];
              const toRate = to === 'USD' ? 1 : rates[to];
              const Decimal = require('decimal.js');
              return amount.div(new Decimal(fromRate)).mul(new Decimal(toRate));
            }),
          },
        },
      ],
    }).compile();
    service = module.get<ReportsService>(ReportsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(service).toBeDefined(); });

  describe('findAll', () => {
    it('returns all reports for user', async () => {
      mockReportRepo.find.mockResolvedValue([mockReport]);
      expect(await service.findAll('user-1')).toEqual([mockReport]);
    });
  });

  describe('findOne', () => {
    it('returns report', async () => {
      mockReportRepo.findOne.mockResolvedValue(mockReport);
      expect(await service.findOne('user-1', 'rep-1')).toEqual(mockReport);
    });
    it('throws NotFoundException when not found', async () => {
      mockReportRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('user-1', 'rep-1')).rejects.toThrow(NotFoundException);
    });
    it('throws ForbiddenException for wrong user', async () => {
      mockReportRepo.findOne.mockResolvedValue({ ...mockReport, userId: 'other-user' });
      await expect(service.findOne('user-1', 'rep-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('generate', () => {
    it('creates report with PENDING status and enqueues job', async () => {
      const newReport = { id: 'rep-2', userId: 'user-1', type: ReportType.SUMMARY, status: ReportStatus.PENDING };
      mockReportRepo.create.mockReturnValue(newReport);
      mockReportRepo.save.mockResolvedValue(newReport);
      mockUserRepo.findOne.mockResolvedValue({ id: 'user-1', plan: 'pro' });
      mockReportRepo.count.mockResolvedValue(0);

      const result = await service.generate('user-1', '2024-01-01', '2024-01-31', ReportType.SUMMARY);
      expect(mockReportRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        type: ReportType.SUMMARY,
        status: ReportStatus.PENDING,
      }));
      expect(mockReportRepo.save).toHaveBeenCalledWith(newReport);
      expect(mockQueue.add).toHaveBeenCalledWith('generate-pdf', expect.objectContaining({
        reportId: 'rep-2',
        userId: 'user-1',
      }));
      expect(result).toEqual(newReport);
    });
  });

  describe('downloadPdf', () => {
    it('throws NotFoundException when report is not READY', async () => {
      mockReportRepo.findOne.mockResolvedValue({ ...mockReport, status: ReportStatus.PENDING });
      await expect(service.downloadPdf('user-1', 'rep-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when report does not exist', async () => {
      mockReportRepo.findOne.mockResolvedValue(null);
      await expect(service.downloadPdf('user-1', 'non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('buildAndStorePdf', () => {
    const mockSubRepoQB = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: 'sub-1', name: 'Netflix', amount: 15, currency: 'USD', category: 'ENTERTAINMENT', billingPeriod: 'MONTHLY', status: 'ACTIVE', addedVia: 'manual', paymentCardId: null, isBusinessExpense: false },
          { id: 'sub-2', name: 'Work Tool', amount: 20, currency: 'USD', category: 'PRODUCTIVITY', billingPeriod: 'MONTHLY', status: 'ACTIVE', addedVia: 'manual', paymentCardId: 'card-1', isBusinessExpense: true },
        ]),
      })),
    };

    it('builds PDF for SUMMARY report and updates status to READY', async () => {
      mockReportRepo.findOne.mockResolvedValue(mockReport);
      mockUserRepo.findOne.mockResolvedValue({ id: 'user-1', email: 'test@test.com' });
      mockCardRepo.find.mockResolvedValue([{ id: 'card-1', last4: '4242', brand: 'Visa' }]);
      (service as any).subRepo = mockSubRepoQB;

      await service.buildAndStorePdf('user-1', 'rep-1');

      // Should have updated status to GENERATING, then to READY
      expect(mockReportRepo.update).toHaveBeenCalledWith('rep-1', expect.objectContaining({
        status: ReportStatus.GENERATING,
      }));
      expect(mockReportRepo.update).toHaveBeenCalledWith('rep-1', expect.objectContaining({
        status: ReportStatus.READY,
      }));
    });

    it('builds PDF for DETAILED report', async () => {
      const detailedReport = { ...mockReport, type: ReportType.DETAILED };
      mockReportRepo.findOne.mockResolvedValue(detailedReport);
      mockUserRepo.findOne.mockResolvedValue({ id: 'user-1', email: 'test@test.com' });
      mockCardRepo.find.mockResolvedValue([{ id: 'card-1', last4: '4242', brand: 'Visa' }]);
      (service as any).subRepo = mockSubRepoQB;

      await service.buildAndStorePdf('user-1', 'rep-1');
      expect(mockReportRepo.update).toHaveBeenCalledWith('rep-1', expect.objectContaining({
        status: ReportStatus.READY,
      }));
    });

    it('builds PDF for TAX report', async () => {
      const taxReport = { ...mockReport, type: ReportType.TAX };
      mockReportRepo.findOne.mockResolvedValue(taxReport);
      mockUserRepo.findOne.mockResolvedValue({ id: 'user-1', email: 'test@test.com' });
      mockCardRepo.find.mockResolvedValue([{ id: 'card-1', last4: '4242', brand: 'Visa' }]);
      (service as any).subRepo = mockSubRepoQB;

      await service.buildAndStorePdf('user-1', 'rep-1');
      expect(mockReportRepo.update).toHaveBeenCalledWith('rep-1', expect.objectContaining({
        status: ReportStatus.READY,
      }));
    });

    it('builds PDF with no subscriptions', async () => {
      mockReportRepo.findOne.mockResolvedValue({ ...mockReport, type: ReportType.SUMMARY });
      mockUserRepo.findOne.mockResolvedValue({ id: 'user-1', email: 'test@test.com' });
      mockCardRepo.find.mockResolvedValue([]);
      (service as any).subRepo = {
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        })),
      };

      await service.buildAndStorePdf('user-1', 'rep-1');
      expect(mockReportRepo.update).toHaveBeenCalledWith('rep-1', expect.objectContaining({
        status: ReportStatus.READY,
      }));
    });

    it('sets FAILED status on error', async () => {
      mockReportRepo.findOne.mockResolvedValue(null); // Will cause NotFoundException
      mockReportRepo.update.mockResolvedValue({});

      await expect(service.buildAndStorePdf('user-1', 'rep-1')).rejects.toThrow();
      expect(mockReportRepo.update).toHaveBeenCalledWith('rep-1', expect.objectContaining({
        status: ReportStatus.FAILED,
      }));
    });
  });
});
