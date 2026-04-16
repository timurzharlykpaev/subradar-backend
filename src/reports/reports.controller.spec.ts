import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportType } from './entities/report.entity';

describe('ReportsController', () => {
  let controller: ReportsController;

  const mockReport = { id: 'report-1', type: ReportType.SUMMARY };

  const mockService = {
    generate: jest.fn().mockResolvedValue(mockReport),
    findAll: jest.fn().mockResolvedValue([mockReport]),
    findOne: jest.fn().mockImplementation((userId: string, id: string) => {
      if (id === 'nonexistent') throw new NotFoundException();
      return Promise.resolve(mockReport);
    }),
    generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf-content')),
    downloadPdf: jest.fn().mockResolvedValue(Buffer.from('pdf-content')),
  };

  const req = { user: { id: 'user-1' } } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: mockService }],
    }).compile();

    controller = module.get<ReportsController>(ReportsController);
    jest.clearAllMocks();
    mockService.generate.mockResolvedValue(mockReport);
    mockService.findAll.mockResolvedValue([mockReport]);
    mockService.findOne.mockImplementation((userId: string, id: string) => {
      if (id === 'nonexistent') throw new NotFoundException();
      return Promise.resolve(mockReport);
    });
    mockService.downloadPdf.mockResolvedValue(Buffer.from('pdf-content'));
  });

  it('should be defined', () => expect(controller).toBeDefined());

  it('generate → calls service.generate with from/to/type', async () => {
    const dto = { from: '2024-01-01', to: '2024-01-31', type: ReportType.SUMMARY } as any;
    const result = await controller.generate(req, dto);
    expect(mockService.generate).toHaveBeenCalledWith('user-1', '2024-01-01', '2024-01-31', ReportType.SUMMARY, undefined);
    expect(result).toHaveProperty('id');
  });

  it('generate → uses startDate/endDate aliases', async () => {
    const dto = { startDate: '2024-02-01', endDate: '2024-02-29', type: ReportType.DETAILED } as any;
    await controller.generate(req, dto);
    expect(mockService.generate).toHaveBeenCalledWith('user-1', '2024-02-01', '2024-02-29', ReportType.DETAILED, undefined);
  });

  it('generate → falls back to empty strings when no dates', async () => {
    const dto = { type: ReportType.SUMMARY } as any;
    await controller.generate(req, dto);
    expect(mockService.generate).toHaveBeenCalledWith('user-1', '', '', ReportType.SUMMARY, undefined);
  });

  it('findAll → returns array of reports', async () => {
    const result = await controller.findAll(req);
    expect(mockService.findAll).toHaveBeenCalledWith('user-1');
    expect(Array.isArray(result)).toBe(true);
  });

  it('findOne → returns report when found', async () => {
    const result = await controller.findOne(req, 'report-1');
    expect(result).toHaveProperty('id', 'report-1');
  });

  it('findOne → throws NotFoundException when not found', async () => {
    await expect(controller.findOne(req, 'nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('download → sends PDF buffer as response', async () => {
    const res = {
      set: jest.fn(),
      end: jest.fn(),
    } as any;
    await controller.download(req, 'report-1', res);
    expect(mockService.downloadPdf).toHaveBeenCalledWith('user-1', 'report-1');
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'application/pdf' }));
    expect(res.end).toHaveBeenCalled();
  });
});
