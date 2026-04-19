import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { InviteCode } from './entities/invite-code.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { AnalysisModule } from '../analysis/analysis.module';
import { UsersModule } from '../users/users.module';
import { GuardsModule } from '../common/guards/guards.module';
import { OutboxModule } from '../billing/outbox/outbox.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Workspace, WorkspaceMember, InviteCode, Subscription]),
    forwardRef(() => AnalysisModule),
    UsersModule,
    GuardsModule,
    OutboxModule,
  ],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
