import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FxService } from './fx.service';
import { TelegramAlertService } from '../common/telegram-alert.service';
import { runCronHandler } from '../common/cron/run-cron-handler';

@Injectable()
export class FxCron {
  private readonly logger = new Logger(FxCron.name);

  constructor(
    private readonly fx: FxService,
    private readonly tg: TelegramAlertService,
  ) {}

  @Cron('0 3 * * *')
  async refreshDaily(): Promise<void> {
    await runCronHandler('fxRefreshDaily', this.logger, this.tg, async () => {
      const result = await this.fx.refreshFromApi();
      this.logger.log(
        `FX rates refreshed: ${Object.keys(result.rates).length} currencies from ${result.source}`,
      );
    });
  }
}
