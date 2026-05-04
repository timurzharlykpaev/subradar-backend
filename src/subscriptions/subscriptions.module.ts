import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from './entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionLimitGuard } from './guards/subscription-limit.guard';
import { EmailImportController } from './email-import.controller';
import { TrialCheckerCron } from './trial-checker.cron';
import { ReceiptsModule } from '../receipts/receipts.module';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiModule } from '../ai/ai.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { BillingModule } from '../billing/billing.module';
import { FxModule } from '../fx/fx.module';
import { CatalogPlan } from '../catalog/entities/catalog-plan.entity';
import { KnownBillingSender } from './email-import/known-billing-sender.entity';
import { RequireProGuard } from '../auth/guards/require-pro.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, User, CatalogPlan, KnownBillingSender]),
    ReceiptsModule,
    UsersModule,
    NotificationsModule,
    AiModule,
    FxModule,
    forwardRef(() => AnalysisModule),
    forwardRef(() => BillingModule),
  ],
  providers: [SubscriptionsService, TrialCheckerCron, SubscriptionLimitGuard, RequireProGuard],
  controllers: [SubscriptionsController, EmailImportController],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
