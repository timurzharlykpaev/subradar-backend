import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UsersService } from '../users/users.service';
import { PLANS } from '../billing/plans.config';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly repo: Repository<Subscription>,
    private readonly usersService: UsersService,
  ) {}

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
    return this.repo.save(sub);
  }

  async remove(userId: string, id: string): Promise<void> {
    const sub = await this.findOne(userId, id);
    await this.repo.remove(sub);
  }

  findAllForUser(userId: string) {
    return this.repo.find({ where: { userId } });
  }
}
