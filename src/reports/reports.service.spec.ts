import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { Report, ReportType, ReportStatus } from './entities/report.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { PaymentCard } from '../payment-cards/entities/payment-card.entity';

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
      y: 100,
    };
    return doc;
  });
});

const mockReportRepo = { create: jest.fn(), save: jest.fn(), find: jest.fn(), findOne: jest.fn(), remove: jest.fn() };
const mockSubRepo = { find: jest.fn() };
const mockCardRepo = { find: jest.fn() };

const mockReport = { id: 'rep-1', userId: 'user-1', status: ReportStatus.READY, type: ReportType.SUMMARY, pdfUrl: 'http://example.com/rep.pdf', from: '2024-01-01', to: '2024-01-31' };

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getRepositoryToken(Report), useValue: mockReportRepo },
        { provide: getRepositoryToken(Subscription), useValue: mockSubRepo },
        { provide: getRepositoryToken(PaymentCard), useValue: mockCardRepo },
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
    it('creates and saves a report', async () => {
      const newReport = { id: 'rep-2', userId: 'user-1', type: ReportType.MONTHLY, status: ReportStatus.READY };
      mockReportRepo.create.mockReturnValue(newReport);
      mockReportRepo.save.mockResolvedValue(newReport);

      const result = await service.generate('user-1', '2024-01-01', '2024-01-31', ReportType.MONTHLY);
      expect(mockReportRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        type: ReportType.MONTHLY,
        status: ReportStatus.READY,
      }));
      expect(mockReportRepo.save).toHaveBeenCalledWith(newReport);
      expect(result).toEqual(newReport);
    });
  });

  describe('generatePdf', () => {
    const mockSubRepo2 = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: 'sub-1', name: 'Netflix', amount: 15, currency: 'USD', category: 'ENTERTAINMENT', billingPeriod: 'MONTHLY', status: 'ACTIVE', addedVia: 'manual', paymentCardId: null, isBusinessExpense: false },
          { id: 'sub-2', name: 'Work Tool', amount: 20, currency: 'USD', category: 'PRODUCTIVITY', billingPeriod: 'MONTHLY', status: 'ACTIVE', addedVia: 'manual', paymentCardId: 'card-1', isBusinessExpense: true },
        ]),
      })),
    };

    it('generates PDF for SUMMARY report', async () => {
      mockReportRepo.findOne.mockResolvedValue(mockReport);
      mockCardRepo.find.mockResolvedValue([{ id: 'card-1', last4: '4242', brand: 'Visa' }]);
      // Patch subRepo with queryBuilder support
      (service as any).subRepo = mockSubRepo2;

      const result = await service.generatePdf('user-1', 'rep-1');
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('generates PDF for DETAILED report', async () => {
      const detailedReport = { ...mockReport, type: ReportType.DETAILED };
      mockReportRepo.findOne.mockResolvedValue(detailedReport);
      mockCardRepo.find.mockResolvedValue([{ id: 'card-1', last4: '4242', brand: 'Visa' }]);
      (service as any).subRepo = mockSubRepo2;

      const result = await service.generatePdf('user-1', 'rep-1');
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('generates PDF for TAX report', async () => {
      const taxReport = { ...mockReport, type: ReportType.TAX };
      mockReportRepo.findOne.mockResolvedValue(taxReport);
      mockCardRepo.find.mockResolvedValue([{ id: 'card-1', last4: '4242', brand: 'Visa' }]);
      (service as any).subRepo = mockSubRepo2;

      const result = await service.generatePdf('user-1', 'rep-1');
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('generates PDF with no subscriptions', async () => {
      mockReportRepo.findOne.mockResolvedValue({ ...mockReport, type: ReportType.SUMMARY });
      mockCardRepo.find.mockResolvedValue([]);
      (service as any).subRepo = {
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        })),
      };

      const result = await service.generatePdf('user-1', 'rep-1');
      expect(Buffer.isBuffer(result)).toBe(true);
    });
  });
});
