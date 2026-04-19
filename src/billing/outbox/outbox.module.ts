import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from './entities/outbox-event.entity';
import { OutboxService } from './outbox.service';
import { OutboxWorker } from './outbox.worker';
import { AmplitudeHandler } from './handlers/amplitude.handler';
import { TelegramHandler } from './handlers/telegram.handler';
import { FcmHandler } from './handlers/fcm.handler';
import { NotificationsModule } from '../../notifications/notifications.module';

/**
 * Outbox module wires the service + worker + handlers together.
 *
 * - TelegramAlertService is provided by the `@Global` TelegramAlertModule
 *   bootstrapped in AppModule, so we don't import anything for it here.
 * - NotificationsService lives in NotificationsModule — imported with
 *   `forwardRef` to stay resilient if the notifications module ever
 *   grows a back-reference to billing.
 * - AmplitudeHandler has no external deps today (TODO: real client).
 *
 * OutboxService is exported so state-machine / webhook code can
 * `enqueue(...)` in the same transaction as their DB writes.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEvent]),
    forwardRef(() => NotificationsModule),
  ],
  providers: [
    OutboxService,
    OutboxWorker,
    AmplitudeHandler,
    TelegramHandler,
    FcmHandler,
  ],
  exports: [OutboxService],
})
export class OutboxModule {}
