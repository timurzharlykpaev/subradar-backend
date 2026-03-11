import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { Report, ReportType, ReportStatus } from './entities/report.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { PaymentCard } from '../payment-cards/entities/payment-card.entity';

jest.mock('pdfkit', () => jest.fn().mockImplementation(() => ({
  on: jest.fn(), end: jest.fn(), pipe: jest.fn(),
  fontSize: jest.fn().mockReturnThis(), text: jest.fn().mockReturnThis(), moveDown: jest.fn().mockReturnThis(),
})));

const mockReportRepo = { create: jest.fn(), save: jest.fn(), find: jest.fn(), findOne: jest.fn(), remove: jest.fn() };
const mockSubRepo = { find: jest.fn() };
const mockCardRepo = { find: jest.fn() };

const mockReport = { id: 'rep-1', userId: 'user-1', status: ReportStatus.COMPLETED, type: ReportType.MONTHLY, pdfUrl: 'http://example.com/rep.pdf', from: '2024-01-01', to: '2024-01-31' };

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
});
