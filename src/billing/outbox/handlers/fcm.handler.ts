import { Injectable } from '@nestjs/common';
import { NotificationsService } from '../../../notifications/notifications.service';

/**
 * FCM / push outbox handler. Delegates to NotificationsService which
 * already handles both Expo push tokens and raw Firebase FCM tokens
 * (see NotificationsService.sendPushNotification).
 *
 * Payload contract:
 *   { token: string; title: string; body: string; data?: Record<string, string> }
 */
@Injectable()
export class FcmHandler {
  constructor(private readonly notifications: NotificationsService) {}

  async handle(payload: Record<string, unknown>): Promise<void> {
    const { token, title, body, data } = payload as {
      token: string;
      title: string;
      body: string;
      data?: Record<string, string>;
    };

    if (!token || !title || !body) {
      throw new Error(
        `FcmHandler: malformed payload (token=${!!token}, title=${!!title}, body=${!!body})`,
      );
    }

    await this.notifications.sendPushNotification(token, title, body, data);
  }
}
