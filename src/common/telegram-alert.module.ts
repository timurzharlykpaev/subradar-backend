import { Global, Module } from '@nestjs/common';
import { TelegramAlertService } from './telegram-alert.service';

// @Global() — TelegramAlertService is used from crons, filters, and services
// spread across 12+ feature modules. Requiring every one of them to import
// a CommonModule is both noisy and easy to forget (we already shipped a
// crash-loop to prod because FxModule didn't import it). A global provider
// also matters for correctness: the service holds an in-memory dedup map
// that must be singleton — duplicated instances would break rate-limiting
// of Telegram alerts.
@Global()
@Module({
  providers: [TelegramAlertService],
  exports: [TelegramAlertService],
})
export class TelegramAlertModule {}
