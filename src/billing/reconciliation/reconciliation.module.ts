import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../users/entities/user.entity';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationCron } from './reconciliation.cron';
import { RevenueCatClientModule } from '../revenuecat/rc-client.module';
import { AuditModule } from '../../common/audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { BillingModule } from '../billing.module';

/**
 * Wires the hourly billing-reconciliation job.
 *
 * AuditModule is declared `@Global` in AppModule so the import here is
 * technically redundant at runtime — we keep it explicit so that unit /
 * integration tests that instantiate this module in isolation still see
 * AuditService. Same pattern ConfigModule follows across the codebase.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User]),
    RevenueCatClientModule,
    AuditModule,
    OutboxModule,
    // UserBillingRepository lives in BillingModule. Forward-ref because
    // BillingModule already imports ReconciliationModule.
    forwardRef(() => BillingModule),
  ],
  providers: [ReconciliationService, ReconciliationCron],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
