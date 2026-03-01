import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from './entities/subscription.entity';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription) private readonly repo: Repository<Subscription>,
  ) {}

  async create(userId: string, dto: CreateSubscriptionDto): Promise<Subscription> {
    const sub = this.repo.create({ ...dto, userId });
    return this.repo.save(sub);
  }

  async findAll(userId: string): Promise<Subscription[]> {
    return this.repo.find({ where: { userId }, relations: ['paymentCard'], order: { createdAt: 'DESC' } });
  }

  async findOne(userId: string, id: string): Promise<Subscription> {
    const sub = await this.repo.findOne({ where: { id }, relations: ['paymentCard'] });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.userId !== userId) throw new ForbiddenException();
    return sub;
  }

  async update(userId: string, id: string, dto: Partial<CreateSubscriptionDto>): Promise<Subscription> {
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
