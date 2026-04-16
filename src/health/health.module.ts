import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { HealthWatchCron } from '../common/health-watch.cron';
import { HeartbeatService } from '../common/heartbeat.service';
import { HeartbeatCron } from '../common/heartbeat.cron';
import { TelegramAlertService } from '../common/telegram-alert.service';

/**
 * Health module — wires terminus indicators for DB + Redis.
 * RedisModule is @Global, so REDIS_CLIENT is available without explicit import.
 *
 * Also hosts:
 *  - HealthWatchCron — alerts Telegram on 3+ consecutive minute failures.
 *  - HeartbeatService + HeartbeatCron — tracks successful cron heartbeats
 *    and alerts on stale ones (CRON_MISSED).
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [HealthWatchCron, HeartbeatService, HeartbeatCron, TelegramAlertService],
  exports: [HeartbeatService],
})
export class HealthModule {}
