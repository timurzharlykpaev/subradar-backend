import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HeartbeatService } from './heartbeat.service';
import { TelegramAlertService } from './telegram-alert.service';
import { runCronHandler, setHeartbeatService } from './cron/run-cron-handler';

/**
 * Hourly watchdog that verifies all registered crons have reported a
 * heartbeat within their expected interval. Missed → CRON_MISSED Telegram
 * alert (deduped per cron name).
 *
 * Also registers the HeartbeatService with runCronHandler so existing crons
 * automatically record heartbeats without a signature change.
 */
@Injectable()
export class HeartbeatCron implements OnModuleInit {
  private readonly logger = new Logger(HeartbeatCron.name);

  constructor(
    private readonly heartbeat: HeartbeatService,
    private readonly tg: TelegramAlertService,
  ) {}

  onModuleInit() {
    setHeartbeatService(this.heartbeat);
  }

  // Runs hourly at :50 (not :00). Offset off the top-of-hour cron rush to
  // spare the shared DO managed PG pool, and :50 means it checks after the
  // hour's other jobs (reminders, expireTrials@:33, reconciliation@:40)
  // have already reported their heartbeats. Interval checks use a 1h grace,
  // so the minute offset never produces false CRON_MISSED alerts.
  @Cron('50 * * * *')
  async monitor() {
    await runCronHandler('heartbeatMonitor', this.logger, this.tg, async () => {
      await this.heartbeat.checkMissed();
    });
  }
}
