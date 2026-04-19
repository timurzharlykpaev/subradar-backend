import { Injectable } from '@nestjs/common';
import { TelegramAlertService } from '../../../common/telegram-alert.service';

/**
 * Telegram outbox handler. Delegates to the existing global
 * TelegramAlertService (which handles dedup + silent-fail when the bot
 * isn't configured).
 *
 * Payload contract:
 *   { text: string; dedupKey?: string }
 *
 * Note: TelegramAlertService.send already swallows network errors and
 * returns `false`. We explicitly throw on a `false` return ONLY when
 * Telegram is configured but the send failed — configuration gaps
 * (missing bot token in dev) should not cause retry storms. We can't
 * cheaply distinguish these cases today, so for now we tolerate `false`
 * and trust the service's internal warning log.
 */
@Injectable()
export class TelegramHandler {
  constructor(private readonly telegram: TelegramAlertService) {}

  async handle(payload: Record<string, unknown>): Promise<void> {
    const { text, dedupKey } = payload as {
      text: string;
      dedupKey?: string;
    };

    if (!text) {
      throw new Error('TelegramHandler: payload.text is required');
    }

    await this.telegram.send(text, dedupKey);
  }
}
