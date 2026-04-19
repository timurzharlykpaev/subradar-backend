import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsController } from './notifications.controller';
import { UnsubscribeController } from './unsubscribe.controller';
import { ResendWebhookController } from './resend-webhook.controller';
import { SuppressionService } from './suppression.service';
import { SuppressedEmail } from './entities/suppressed-email.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    TypeOrmModule.forFeature([SuppressedEmail]),
    UsersModule,
  ],
  providers: [NotificationsService, NotificationsProcessor, SuppressionService],
  controllers: [
    NotificationsController,
    UnsubscribeController,
    ResendWebhookController,
  ],
  exports: [NotificationsService, SuppressionService],
})
export class NotificationsModule {}
