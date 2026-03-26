import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Report } from './entities/report.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { PaymentCard } from '../payment-cards/entities/payment-card.entity';
import { User } from '../users/entities/user.entity';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ReportsProcessor } from './reports.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Report, Subscription, PaymentCard, User]),
    BullModule.registerQueue({ name: 'reports' }),
  ],
  providers: [ReportsService, ReportsProcessor],
  controllers: [ReportsController],
})
export class ReportsModule {}
