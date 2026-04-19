import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserTrial } from './entities/user-trial.entity';
import { TrialsService } from './trials.service';
import { AuditModule } from '../../common/audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';

/**
 * Trials module.
 *
 * AuditModule is already @Global in AppModule, but we import it
 * explicitly here so this module can be bootstrapped in isolation
 * (tests / scripts) without relying on the global surface.
 *
 * OutboxModule is imported because TrialsService.activate enqueues
 * an `amplitude.track` event inside the same transaction as the
 * trial row — see TrialsService for the invariant.
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserTrial]), AuditModule, OutboxModule],
  providers: [TrialsService],
  exports: [TrialsService],
})
export class TrialsModule {}
