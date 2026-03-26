import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { ReportsService } from './reports.service';

@Processor('reports')
export class ReportsProcessor {
  private readonly logger = new Logger(ReportsProcessor.name);

  constructor(private readonly service: ReportsService) {}

  @Process('generate-pdf')
  async handleGeneratePdf(job: Job<{ reportId: string; userId: string }>) {
    const { reportId, userId } = job.data;
    this.logger.log(`Processing PDF generation for report ${reportId}`);

    try {
      await this.service.buildAndStorePdf(userId, reportId);
      this.logger.log(`PDF generation complete for report ${reportId}`);
    } catch (error) {
      this.logger.error(
        `Failed to generate PDF for report ${reportId}: ${error.message}`,
      );
      throw error;
    }
  }
}
