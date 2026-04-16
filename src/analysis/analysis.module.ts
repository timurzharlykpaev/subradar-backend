import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { AnalysisProcessor } from './analysis.processor';
import { AnalysisCronService } from './analysis.cron';
import { MarketDataService } from './market-data.service';
import { AnalysisPlanGuard } from './guards/plan.guard';
import { AnalysisJob } from './entities/analysis-job.entity';
import { AnalysisResult } from './entities/analysis-result.entity';
import { AnalysisUsage } from './entities/analysis-usage.entity';
import { ServiceCatalog } from './entities/service-catalog.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { ANALYSIS_QUEUE } from './analysis.constants';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AnalysisJob, AnalysisResult, AnalysisUsage, ServiceCatalog, Subscription, User]),
    BullModule.registerQueue({
      name: ANALYSIS_QUEUE,
      defaultJobOptions: {
        // Clean up completed jobs aggressively (we care about state, not history).
        removeOnComplete: { age: 24 * 3600, count: 100 },
        // Keep failed jobs for 7 days (for debugging / retry), cap at 1000.
        // Without this, BullMQ keeps only the last 50 failures — losing signal
        // on bursty failures (e.g. OpenAI quota exhaustion affecting 200 jobs).
        removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
      },
    }),
    NotificationsModule,
    forwardRef(() => WorkspaceModule),
    forwardRef(() => BillingModule),
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService, AnalysisProcessor, AnalysisCronService, MarketDataService, AnalysisPlanGuard],
  exports: [AnalysisService, MarketDataService],
})
export class AnalysisModule {}
