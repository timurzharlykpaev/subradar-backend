import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';

describe('ReceiptsController', () => {
  let controller: ReceiptsController;

  const mockService = {
    upload: jest.fn().mockResolvedValue({ id: 'receipt-1', url: 'https://storage.url/file.pdf' }),
    findAll: jest.fn().mockResolvedValue([{ id: 'receipt-1' }]),
  };

  const req = { user: { id: 'user-1' } } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReceiptsController],
      providers: [{ provide: ReceiptsService, useValue: mockService }],
    }).compile();

    controller = module.get<ReceiptsController>(ReceiptsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => expect(controller).toBeDefined());

  it('upload → calls service.upload with userId, file, and subscriptionId', async () => {
    const file = { originalname: 'receipt.pdf', buffer: Buffer.from('pdf') } as any;
    const result = await controller.upload(req, file, 'sub-1');
    expect(mockService.upload).toHaveBeenCalledWith('user-1', file, 'sub-1');
    expect(result).toHaveProperty('id');
  });

  it('upload → calls service.upload without subscriptionId', async () => {
    const file = { originalname: 'receipt.pdf', buffer: Buffer.from('pdf') } as any;
    await controller.upload(req, file, undefined);
    expect(mockService.upload).toHaveBeenCalledWith('user-1', file, undefined);
  });

  it('findAll → returns list of receipts', async () => {
    const result = await controller.findAll(req);
    expect(mockService.findAll).toHaveBeenCalledWith('user-1');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });
});
