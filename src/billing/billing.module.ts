import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { UsersModule } from '../users/users.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { Workspace } from '../workspace/entities/workspace.entity';
import { WorkspaceMember } from '../workspace/entities/workspace-member.entity';
import { User } from '../users/entities/user.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { GracePeriodCron } from './grace-period.cron';
import { TelegramAlertService } from '../common/telegram-alert.service';
import { EffectiveAccessModule } from './effective-access/effective-access.module';
import { OutboxModule } from './outbox/outbox.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Workspace, WorkspaceMember, User, WebhookEvent]),
    UsersModule,
    forwardRef(() => SubscriptionsModule),
    EffectiveAccessModule,
    OutboxModule,
  ],
  // TelegramAlertService is declared globally in AppModule but we re-provide
  // it here so the billing module can run in isolation (tests, migrations).
  providers: [BillingService, GracePeriodCron, TelegramAlertService],
  controllers: [BillingController],
  exports: [BillingService],
})
export class BillingModule {}
