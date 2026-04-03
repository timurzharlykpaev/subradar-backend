import {
  Injectable,
  Inject,
  forwardRef,
  Logger,
  NotFoundException,
  ForbiddenException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis.module';
import {
  Subscription,
  BillingPeriod,
  SubscriptionStatus,
} from './entities/subscription.entity';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { FilterSubscriptionsDto } from './dto/filter-subscriptions.dto';
import { UsersService } from '../users/users.service';
import { PLANS } from '../billing/plans.config';
import { AnalysisService } from '../analysis/analysis.service';

function computeNextPaymentDate(
  startDate: Date,
  billingPeriod: BillingPeriod,
): Date | null {
  if (
    billingPeriod === BillingPeriod.LIFETIME ||
    billingPeriod === BillingPeriod.ONE_TIME
  ) {
    return null;
  }

  const now = new Date();
  const next = new Date(startDate);
  const originalDay = next.getDate();

  while (next <= now) {
    switch (billingPeriod) {
      case BillingPeriod.WEEKLY:
        next.setDate(next.getDate() + 7);
        break;
      case BillingPeriod.MONTHLY: {
        const m = next.getMonth() + 1;
        const y = next.getFullYear() + (m > 11 ? 1 : 0);
        const newMonth = m % 12;
        const lastDay = new Date(y, newMonth + 1, 0).getDate();
        next.setFullYear(y);
        next.setMonth(newMonth);
        next.setDate(Math.min(originalDay, lastDay));
        break;
      }
      case BillingPeriod.QUARTERLY: {
        const mq = next.getMonth() + 3;
        const yq = next.getFullYear() + Math.floor(mq / 12);
        const newMonthQ = mq % 12;
        const lastDayQ = new Date(yq, newMonthQ + 1, 0).getDate();
        next.setFullYear(yq);
        next.setMonth(newMonthQ);
        next.setDate(Math.min(originalDay, lastDayQ));
        break;
      }
      case BillingPeriod.YEARLY:
        next.setFullYear(next.getFullYear() + 1);
        break;
    }
  }

  return next;
}

@Injectable()
export class SubscriptionsService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionsService.name);
  constructor(
    @InjectRepository(Subscription)
    private readonly repo: Repository<Subscription>,
    private readonly usersService: UsersService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(forwardRef(() => AnalysisService))
    private readonly analysisService: AnalysisService,
  ) {}

  async onModuleInit() {
    await this.recalculateNextPaymentDates();
  }

  private async invalidateAnalyticsCache(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      const patterns = [`ai:*${userId}*`, `analytics:*${userId}*`];
      for (const pattern of patterns) {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await this.redis.scan(
            cursor,
            'MATCH',
            pattern,
            'COUNT',
            100,
          );
          cursor = nextCursor;
          if (keys.length > 0) {
            await this.redis.del(...keys);
          }
        } while (cursor !== '0');
      }
    } catch {
      this.logger.warn('Failed to invalidate analytics cache');
    }
  }

  async create(
    userId: string,
    dto: CreateSubscriptionDto,
  ): Promise<Subscription> {
    const user = await this.usersService.findById(userId);
    const planConfig = PLANS[user.plan] ?? PLANS.free;

    if (planConfig.subscriptionLimit !== null) {
      const activeCount = await this.repo.count({
        where: [
          { userId, status: SubscriptionStatus.ACTIVE },
          { userId, status: SubscriptionStatus.TRIAL },
        ],
      });
      if (activeCount >= planConfig.subscriptionLimit) {
        throw new ForbiddenException(
          `Subscription limit reached (${planConfig.subscriptionLimit} on Free plan). Upgrade to Pro for unlimited subscriptions.`,
        );
      }
    }

    const sub = this.repo.create({ ...dto, userId });

    if (sub.startDate && sub.billingPeriod) {
      const next = computeNextPaymentDate(
        new Date(sub.startDate),
        sub.billingPeriod,
      );
      sub.nextPaymentDate = next as Date;
    }

    const saved = await this.repo.save(sub);
    await this.invalidateAnalyticsCache(userId);
    // Trigger analysis re-evaluation (debounced)
    this.analysisService.onSubscriptionChange(userId).catch(err =>
      this.logger.warn(`Analysis trigger failed: ${err.message}`),
    );
    return saved;
  }

  async countActive(userId: string): Promise<number> {
    return this.repo.count({
      where: [
        { userId, status: SubscriptionStatus.ACTIVE },
        { userId, status: SubscriptionStatus.TRIAL },
      ],
    });
  }

  async findAll(userId: string, filters?: FilterSubscriptionsDto): Promise<Subscription[]> {
    const qb = this.repo
      .createQueryBuilder('sub')
      .leftJoinAndSelect('sub.paymentCard', 'paymentCard')
      .where('sub.userId = :userId', { userId });

    if (filters?.status) {
      qb.andWhere('sub.status = :status', { status: filters.status });
    }

    if (filters?.category) {
      qb.andWhere('sub.category = :category', { category: filters.category });
    }

    if (filters?.search) {
      qb.andWhere('sub.name ILIKE :search', { search: `%${filters.search}%` });
    }

    const sortField = filters?.sort || 'createdAt';
    const sortOrder = filters?.order || 'DESC';
    qb.orderBy(`sub.${sortField}`, sortOrder);

    // Optional pagination (backward compatible — no limit = all results)
    if (filters?.limit) {
      qb.take(filters.limit);
      if (filters?.offset) qb.skip(filters.offset);
    }

    return qb.getMany();
  }

  async findOne(userId: string, id: string): Promise<Subscription> {
    const sub = await this.repo.findOne({
      where: { id },
      relations: ['paymentCard'],
    });
    if (!sub || sub.userId !== userId) throw new NotFoundException('Subscription not found');
    return sub;
  }

  async update(
    userId: string,
    id: string,
    dto: Partial<CreateSubscriptionDto>,
  ): Promise<Subscription> {
    const sub = await this.findOne(userId, id);
    Object.assign(sub, dto);

    if (dto.billingPeriod || dto.startDate) {
      const startDate = sub.startDate ? new Date(sub.startDate) : null;
      if (startDate && sub.billingPeriod) {
        const next = computeNextPaymentDate(startDate, sub.billingPeriod);
        sub.nextPaymentDate = next as Date;
      }
    }

    const saved = await this.repo.save(sub);
    await this.invalidateAnalyticsCache(userId);
    // Trigger analysis re-evaluation (debounced)
    this.analysisService.onSubscriptionChange(userId).catch(err =>
      this.logger.warn(`Analysis trigger failed: ${err.message}`),
    );
    return saved;
  }

  async remove(userId: string, id: string): Promise<void> {
    const sub = await this.findOne(userId, id);
    await this.repo.remove(sub);
    await this.invalidateAnalyticsCache(userId);
    // Trigger analysis re-evaluation (debounced)
    this.analysisService.onSubscriptionChange(userId).catch(err =>
      this.logger.warn(`Analysis trigger failed: ${err.message}`),
    );
  }

  async updateStatus(
    userId: string,
    id: string,
    status: SubscriptionStatus,
  ): Promise<Subscription> {
    const sub = await this.findOne(userId, id);
    sub.status = status;
    if (status === SubscriptionStatus.CANCELLED) {
      sub.cancelledAt = new Date();
    }
    const saved = await this.repo.save(sub);
    await this.invalidateAnalyticsCache(userId);
    return saved;
  }

  findAllForUser(userId: string) {
    return this.repo.find({ where: { userId } });
  }

  async recalculateNextPaymentDates(): Promise<number> {
    const today = new Date().toISOString().split('T')[0];

    const subs = await this.repo.find({
      where: [
        {
          status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]),
          nextPaymentDate: IsNull(),
        },
        {
          status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]),
          nextPaymentDate: LessThanOrEqual(new Date(today)),
        },
      ],
    });

    const toUpdate: typeof subs = [];
    for (const sub of subs) {
      if (!sub.startDate || !sub.billingPeriod) continue;

      const next = computeNextPaymentDate(
        new Date(sub.startDate),
        sub.billingPeriod,
      );
      if (next && (!sub.nextPaymentDate || next > sub.nextPaymentDate)) {
        sub.nextPaymentDate = next;
        toUpdate.push(sub);
      }
    }

    if (toUpdate.length > 0) {
      await this.repo.save(toUpdate); // bulk save — single query
    }

    this.logger.log(`Recalculated nextPaymentDate for ${toUpdate.length} subscriptions`);
    return toUpdate.length;
  }

  @Cron('0 0 * * *')
  async dailyNextPaymentUpdate(): Promise<void> {
    this.logger.log('Running daily nextPaymentDate update');
    await this.recalculateNextPaymentDates();
  }
}
