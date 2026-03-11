import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { PaymentCardsService } from './payment-cards.service';
import { PaymentCard } from './entities/payment-card.entity';

const mockCard: Partial<PaymentCard> = {
  id: 'card-1',
  userId: 'user-1',
  nickname: 'My Visa',
  last4: '4242',
  brand: 'VISA' as any,
  isDefault: false,
};

const mockRepo = {
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([mockCard]),
  create: jest.fn().mockImplementation((d) => d),
  save: jest.fn().mockImplementation((e) => Promise.resolve({ id: 'card-1', ...e })),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
  remove: jest.fn().mockResolvedValue(undefined),
};

describe('PaymentCardsService', () => {
  let service: PaymentCardsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentCardsService,
        { provide: getRepositoryToken(PaymentCard), useValue: mockRepo },
      ],
    }).compile();
    service = module.get<PaymentCardsService>(PaymentCardsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates and saves card', async () => {
      mockRepo.create.mockReturnValueOnce(mockCard);
      mockRepo.save.mockResolvedValueOnce(mockCard);
      const result = await service.create('user-1', { nickname: 'My Visa', last4: '4242', brand: 'VISA' as any });
      expect(result).toEqual(mockCard);
    });

    it('resets other defaults when isDefault=true', async () => {
      mockRepo.create.mockReturnValueOnce({ ...mockCard, isDefault: true });
      mockRepo.save.mockResolvedValueOnce({ ...mockCard, isDefault: true });
      await service.create('user-1', { nickname: 'Main', last4: '1111', brand: 'MASTERCARD' as any, isDefault: true });
      expect(mockRepo.update).toHaveBeenCalledWith({ userId: 'user-1' }, { isDefault: false });
    });
  });

  describe('findAll', () => {
    it('returns array of cards', async () => {
      mockRepo.find.mockResolvedValueOnce([mockCard]);
      const result = await service.findAll('user-1');
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toEqual(mockCard);
    });
  });

  describe('findOne', () => {
    it('returns card for owner', async () => {
      mockRepo.findOne.mockResolvedValueOnce(mockCard);
      const result = await service.findOne('user-1', 'card-1');
      expect(result).toEqual(mockCard);
    });

    it('throws NotFoundException when card not found', async () => {
      mockRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.findOne('user-1', 'bad-id')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when not owner', async () => {
      mockRepo.findOne.mockResolvedValueOnce({ ...mockCard, userId: 'other-user' });
      await expect(service.findOne('user-1', 'card-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('updates card fields', async () => {
      mockRepo.findOne.mockResolvedValueOnce(mockCard);
      mockRepo.save.mockResolvedValueOnce({ ...mockCard, nickname: 'Updated' });
      const result = await service.update('user-1', 'card-1', { nickname: 'Updated' });
      expect(result.nickname).toBe('Updated');
    });
  });

  describe('remove', () => {
    it('removes card', async () => {
      mockRepo.findOne.mockResolvedValueOnce(mockCard);
      await service.remove('user-1', 'card-1');
      expect(mockRepo.remove).toHaveBeenCalledWith(mockCard);
    });
  });
});
