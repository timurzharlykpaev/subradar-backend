import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { UsersModule } from '../users/users.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { Workspace } from '../workspace/entities/workspace.entity';
import { WorkspaceMember } from '../workspace/entities/workspace-member.entity';
import { User } from '../users/entities/user.entity';
import { GracePeriodCron } from './grace-period.cron';

@Module({
  imports: [
    TypeOrmModule.forFeature([Workspace, WorkspaceMember, User]),
    UsersModule,
    forwardRef(() => SubscriptionsModule),
  ],
  providers: [BillingService, GracePeriodCron],
  controllers: [BillingController],
  exports: [BillingService],
})
export class BillingModule {}
