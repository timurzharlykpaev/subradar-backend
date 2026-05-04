import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { ReportsService } from './reports.service';

@Processor('reports')
export class ReportsProcessor {
  private readonly logger = new Logger(ReportsProcessor.name);

  constructor(private readonly service: ReportsService) {}

  @Process('generate-pdf')
  async handleGeneratePdf(
    job: Job<{ reportId: string; userId: string; locale?: string; displayCurrency?: string }>,
  ) {
    const { reportId, userId, locale, displayCurrency } = job.data;
    this.logger.log(
      `Processing PDF generation for report ${reportId} (locale: ${locale || 'en'}, currency: ${displayCurrency || 'auto'})`,
    );

    try {
      await this.service.buildAndStorePdf(userId, reportId, locale || 'en', displayCurrency);
      this.logger.log(`PDF generation complete for report ${reportId}`);
    } catch (error) {
      this.logger.error(
        `Failed to generate PDF for report ${reportId}: ${error.message}`,
      );
      throw error;
    }
  }
}
