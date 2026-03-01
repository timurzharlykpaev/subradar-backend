import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentCard } from './entities/payment-card.entity';
import { PaymentCardsService } from './payment-cards.service';
import { PaymentCardsController } from './payment-cards.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentCard])],
  providers: [PaymentCardsService],
  controllers: [PaymentCardsController],
  exports: [PaymentCardsService],
})
export class PaymentCardsModule {}
