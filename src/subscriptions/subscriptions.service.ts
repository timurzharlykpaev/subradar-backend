import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import {
  Subscription,
  BillingPeriod,
  SubscriptionStatus,
} from './entities/subscription.entity';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UsersService } from '../users/users.service';
import { PLANS } from '../billing/plans.config';

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

  while (next <= now) {
    switch (billingPeriod) {
      case BillingPeriod.WEEKLY:
        next.setDate(next.getDate() + 7);
        break;
      case BillingPeriod.MONTHLY:
        next.setMonth(next.getMonth() + 1);
        break;
      case BillingPeriod.QUARTERLY:
        next.setMonth(next.getMonth() + 3);
        break;
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
  ) {}

  async onModuleInit() {
    await this.recalculateNextPaymentDates();
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

    return this.repo.save(sub);
  }

  async findAll(userId: string): Promise<Subscription[]> {
    return this.repo.find({
      where: { userId },
      relations: ['paymentCard'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(userId: string, id: string): Promise<Subscription> {
    const sub = await this.repo.findOne({
      where: { id },
      relations: ['paymentCard'],
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.userId !== userId) throw new ForbiddenException();
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

    return this.repo.save(sub);
  }

  async remove(userId: string, id: string): Promise<void> {
    const sub = await this.findOne(userId, id);
    await this.repo.remove(sub);
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
    return this.repo.save(sub);
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

    let updated = 0;
    for (const sub of subs) {
      if (!sub.startDate || !sub.billingPeriod) continue;

      const next = computeNextPaymentDate(
        new Date(sub.startDate),
        sub.billingPeriod,
      );
      if (next && (!sub.nextPaymentDate || next > sub.nextPaymentDate)) {
        sub.nextPaymentDate = next;
        await this.repo.save(sub);
        updated++;
      }
    }

    this.logger.log(`Recalculated nextPaymentDate for ${updated} subscriptions`);
    return updated;
  }

  @Cron('0 0 * * *')
  async dailyNextPaymentUpdate(): Promise<void> {
    this.logger.log('Running daily nextPaymentDate update');
    await this.recalculateNextPaymentDates();
  }
}
