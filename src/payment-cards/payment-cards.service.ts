import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentCard } from './entities/payment-card.entity';
import { CreatePaymentCardDto } from './dto/create-payment-card.dto';

@Injectable()
export class PaymentCardsService {
  constructor(
    @InjectRepository(PaymentCard)
    private readonly repo: Repository<PaymentCard>,
  ) {}

  async create(
    userId: string,
    dto: CreatePaymentCardDto,
  ): Promise<PaymentCard> {
    if (dto.isDefault) {
      await this.repo.update({ userId }, { isDefault: false });
    }
    const card = this.repo.create({ ...dto, userId });
    return this.repo.save(card);
  }

  async findAll(userId: string): Promise<PaymentCard[]> {
    return this.repo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async findOne(userId: string, id: string): Promise<PaymentCard> {
    const card = await this.repo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Payment card not found');
    if (card.userId !== userId) throw new ForbiddenException();
    return card;
  }

  async update(
    userId: string,
    id: string,
    dto: Partial<CreatePaymentCardDto>,
  ): Promise<PaymentCard> {
    const card = await this.findOne(userId, id);
    if (dto.isDefault) {
      await this.repo.update({ userId }, { isDefault: false });
    }
    Object.assign(card, dto);
    return this.repo.save(card);
  }

  async remove(userId: string, id: string): Promise<void> {
    const card = await this.findOne(userId, id);
    await this.repo.remove(card);
  }
}
