import { Test, TestingModule } from '@nestjs/testing';
import { PaymentCardsController } from './payment-cards.controller';
import { PaymentCardsService } from './payment-cards.service';

const mockService = { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() };
const mockReq = { user: { id: 'user-1' } };

describe('PaymentCardsController', () => {
  let controller: PaymentCardsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentCardsController],
      providers: [{ provide: PaymentCardsService, useValue: mockService }],
    })
      .overrideGuard(require('../auth/guards/jwt-auth.guard').JwtAuthGuard).useValue({ canActivate: () => true })
      .compile();
    controller = module.get<PaymentCardsController>(PaymentCardsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(controller).toBeDefined(); });
  it('findAll calls service.findAll', async () => {
    mockService.findAll.mockResolvedValue([]);
    expect(await controller.findAll(mockReq as any)).toEqual([]);
  });
  it('create calls service.create', async () => {
    mockService.create.mockResolvedValue({ id: 'card-1' });
    const dto = { nickname: 'My Card', last4: '4242', brand: 'VISA' as any };
    expect(await controller.create(mockReq as any, dto)).toEqual({ id: 'card-1' });
  });
  it('remove calls service.remove', async () => {
    mockService.remove.mockResolvedValue(undefined);
    await controller.remove(mockReq as any, 'card-1');
    expect(mockService.remove).toHaveBeenCalledWith('user-1', 'card-1');
  });
});
