import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { RemindersService } from './reminders.service';
import { MonthlyReportService } from './monthly-report.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, User]),
    NotificationsModule,
    ScheduleModule,
    BillingModule,
  ],
  providers: [RemindersService, MonthlyReportService],
})
export class RemindersModule {}
