import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { Subscription, SubscriptionStatus, BillingPeriod } from '../subscriptions/entities/subscription.entity';
import { PaymentCard } from '../payment-cards/entities/payment-card.entity';
import { REDIS_CLIENT } from '../common/redis.module';
import { FxService } from '../fx/fx.service';
import { UsersService } from '../users/users.service';

const mockSubRepo = {
  find: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  })),
};
const mockCardRepo = { find: jest.fn() };

const activeSub = {
  id: 'sub-1', userId: 'user-1', name: 'Netflix', amount: '15', currency: 'USD',
  billingPeriod: BillingPeriod.MONTHLY, status: SubscriptionStatus.ACTIVE,
  category: 'STREAMING', isBusinessExpense: false,
  nextPaymentDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(Subscription), useValue: mockSubRepo },
        { provide: getRepositoryToken(PaymentCard), useValue: mockCardRepo },
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
            getRates: jest.fn().mockResolvedValue({ rates: { USD: 1 }, fetchedAt: new Date() }),
            convert: jest.fn((amount) => amount),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn().mockResolvedValue({ id: 'user-1', displayCurrency: 'USD' }),
          },
        },
      ],
    }).compile();
    service = module.get<AnalyticsService>(AnalyticsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(service).toBeDefined(); });

  describe('getSummary', () => {
    it('returns totalMonthly and totalYearly', async () => {
      mockSubRepo.find.mockResolvedValue([activeSub]);
      const result = await service.getSummary('user-1');
      expect(result.totalMonthly).toBe(15);
      expect(result.totalYearly).toBe(180);
    });
    it('returns 0 for empty', async () => {
      mockSubRepo.find.mockResolvedValue([]);
      const result = await service.getSummary('user-1');
      expect(result.totalMonthly).toBe(0);
    });
  });

  describe('getByCategory', () => {
    it('returns categories with totals', async () => {
      mockSubRepo.find.mockResolvedValue([activeSub]);
      const result = await service.getByCategory('user-1');
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].category).toBe('STREAMING');
      expect(result[0].total).toBe(15);
    });
  });

  describe('getMonthly', () => {
    it('returns monthly array', async () => {
      const qb = { where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([activeSub]) };
      mockSubRepo.createQueryBuilder.mockReturnValue(qb);
      const result = await service.getMonthly('user-1', 3);
      expect(result.length).toBe(3);
    });
  });

  describe('getByCard', () => {
    it('groups by card', async () => {
      mockCardRepo.find.mockResolvedValue([{ id: 'card-1', nickname: 'My Card', last4: '4242', brand: 'VISA', color: null }]);
      mockSubRepo.find.mockResolvedValue([{ ...activeSub, paymentCardId: 'card-1' }]);
      const result = await service.getByCard('user-1');
      expect(result[0].card.id).toBe('card-1');
    });
  });

  describe('getTrials', () => {
    it('returns trials with daysUntilTrialEnd', async () => {
      const trialSub = { ...activeSub, status: SubscriptionStatus.TRIAL, trialEndDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) };
      mockSubRepo.find.mockResolvedValue([trialSub]);
      const result = await service.getTrials('user-1');
      expect(result[0]).toHaveProperty('daysUntilTrialEnd');
    });
  });

  describe('getUpcoming', () => {
    it('returns upcoming subscriptions', async () => {
      const upcomingSub = { ...activeSub, status: SubscriptionStatus.ACTIVE, billingDay: new Date().getDate() + 2 };
      mockSubRepo.find.mockResolvedValue([upcomingSub]);
      const result = await service.getUpcoming('user-1', 7);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
