import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../users/entities/user.entity';
import { Subscription } from '../../subscriptions/entities/subscription.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';
import { WorkspaceMember } from '../../workspace/entities/workspace-member.entity';
import { UserTrial } from '../trials/entities/user-trial.entity';
import { EffectiveAccessResolver } from './effective-access.service';

/**
 * EffectiveAccessModule — owns the {@link EffectiveAccessResolver} and
 * the entities it needs to read. BillingModule imports this module so
 * the `GET /billing/me` controller (wired up in a later phase) gets
 * the resolver via DI.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserTrial,
      Workspace,
      WorkspaceMember,
      Subscription,
    ]),
  ],
  providers: [EffectiveAccessResolver],
  exports: [EffectiveAccessResolver],
})
export class EffectiveAccessModule {}
