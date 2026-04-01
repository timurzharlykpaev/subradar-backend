import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';

@Injectable()
export class TelegramAlertService {
  private readonly logger = new Logger(TelegramAlertService.name);
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly dedup = new Map<string, number>();
  private readonly DEDUP_MS = 10 * 60 * 1000; // 10 min

  constructor(private readonly cfg: ConfigService) {
    this.botToken = cfg.get('TELEGRAM_BOT_TOKEN', '');
    this.chatId = cfg.get('TELEGRAM_CHAT_ID', '');
  }

  /**
   * Send a message to Telegram. Fire-and-forget — never throws.
   * Returns false if Telegram is not configured or message was deduped.
   */
  async send(text: string, dedupKey?: string): Promise<boolean> {
    if (!this.botToken || !this.chatId) return false;

    // Dedup — skip identical alerts within 10 min
    if (dedupKey) {
      const last = this.dedup.get(dedupKey);
      const now = Date.now();
      if (last && now - last < this.DEDUP_MS) return false;
      this.dedup.set(dedupKey, now);
      // Cleanup stale keys
      for (const [k, t] of this.dedup) {
        if (now - t > this.DEDUP_MS) this.dedup.delete(k);
      }
    }

    try {
      await this.post(text);
      return true;
    } catch (err) {
      this.logger.warn(`Telegram send failed: ${err}`);
      return false;
    }
  }

  private post(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        chat_id: this.chatId,
        text: text.slice(0, 4000), // Telegram limit
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${this.botToken}/sendMessage`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve());
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
