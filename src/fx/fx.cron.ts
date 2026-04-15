import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FxService } from './fx.service';

@Injectable()
export class FxCron {
  private readonly logger = new Logger(FxCron.name);

  constructor(private readonly fx: FxService) {}

  @Cron('0 3 * * *')
  async refreshDaily(): Promise<void> {
    try {
      const result = await this.fx.refreshFromApi();
      this.logger.log(
        `FX rates refreshed: ${Object.keys(result.rates).length} currencies from ${result.source}`,
      );
    } catch (e: any) {
      this.logger.error(`FX daily refresh failed: ${e.message}`);
    }
  }
}
