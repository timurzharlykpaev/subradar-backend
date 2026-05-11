import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { GmailService } from './gmail.service';
import { GmailScanService } from './gmail-scan.service';
import { GmailController } from './gmail.controller';
import { AiModule } from '../ai/ai.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { BillingModule } from '../billing/billing.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    AiModule,
    AnalysisModule,
    forwardRef(() => BillingModule),
    SubscriptionsModule,
    UsersModule,
    // Push notification on background-scan completion. Module is
    // self-contained — no DI cycle risk vs Gmail.
    NotificationsModule,
  ],
  providers: [GmailService, GmailScanService],
  controllers: [GmailController],
  exports: [GmailService, GmailScanService],
})
export class GmailModule {}
