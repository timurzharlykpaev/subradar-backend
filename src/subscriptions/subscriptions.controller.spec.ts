import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { ReceiptsService } from '../receipts/receipts.service';

const mockService = { findAll: jest.fn(), findAllWithDisplay: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn(), countActive: jest.fn(), updateStatus: jest.fn() };
const mockReceiptsService = { parseScreenshot: jest.fn() };
const mockReq = { user: { id: 'user-1', plan: 'pro' } };

describe('SubscriptionsController', () => {
  let controller: SubscriptionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionsController],
      providers: [
        { provide: SubscriptionsService, useValue: mockService },
        { provide: ReceiptsService, useValue: mockReceiptsService },
      ],
    })
      .overrideGuard(require('../auth/guards/jwt-auth.guard').JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(require('./guards/subscription-limit.guard').SubscriptionLimitGuard).useValue({ canActivate: () => true })
      .compile();
    controller = module.get<SubscriptionsController>(SubscriptionsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(controller).toBeDefined(); });

  it('findAll delegates to service.findAllWithDisplay', async () => {
    mockService.findAllWithDisplay.mockResolvedValue([]);
    const result = await controller.findAll(mockReq as any, {});
    expect(mockService.findAllWithDisplay).toHaveBeenCalledWith(
      'user-1',
      undefined,
      {},
    );
    expect(result).toEqual([]);
  });

  it('findOne calls service.findOne', async () => {
    mockService.findOne.mockResolvedValue({ id: 'sub-1' });
    expect(await controller.findOne(mockReq as any, 'sub-1')).toEqual({ id: 'sub-1' });
  });

  it('create calls service.create', async () => {
    mockService.create.mockResolvedValue({ id: 'sub-new' });
    const dto = { name: 'Netflix' } as any;
    expect(await controller.create(mockReq as any, dto)).toEqual({ id: 'sub-new' });
    expect(mockService.create).toHaveBeenCalledWith('user-1', dto);
  });

  it('checkLimits returns plan info', async () => {
    mockService.countActive.mockResolvedValue(2);
    const result = await controller.checkLimits(mockReq as any);
    expect(result).toHaveProperty('plan', 'pro');
    expect(result.subscriptions.used).toBe(2);
  });
});
