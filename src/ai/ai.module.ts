import { Module, forwardRef } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { BillingModule } from '../billing/billing.module';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [forwardRef(() => BillingModule), AnalysisModule],
  providers: [AiService],
  controllers: [AiController],
  exports: [AiService],
})
export class AiModule {}
