import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

const mockService = { getSummary: jest.fn(), getMonthly: jest.fn(), getByCategory: jest.fn(), getUpcoming: jest.fn(), getTrials: jest.fn(), getByCard: jest.fn() };
const mockReq = { user: { id: 'user-1' } };

describe('AnalyticsController', () => {
  let controller: AnalyticsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [{ provide: AnalyticsService, useValue: mockService }],
    })
      .overrideGuard(require('../auth/guards/jwt-auth.guard').JwtAuthGuard).useValue({ canActivate: () => true })
      .compile();
    controller = module.get<AnalyticsController>(AnalyticsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(controller).toBeDefined(); });
  it('summary calls service.getSummary', async () => {
    mockService.getSummary.mockResolvedValue({ totalMonthly: 15 });
    expect(await controller.summary(mockReq as any)).toEqual({ totalMonthly: 15 });
  });
  it('byCategory calls service.getByCategory', async () => {
    mockService.getByCategory.mockResolvedValue([]);
    expect(await controller.byCategory(mockReq as any)).toEqual([]);
  });
  it('monthly calls service.getMonthly', async () => {
    mockService.getMonthly.mockResolvedValue([]);
    expect(await controller.monthly(mockReq as any)).toEqual([]);
  });
});
