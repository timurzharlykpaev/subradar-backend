import { Controller, Post, Body, Logger, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength } from 'class-validator';
import { TelegramAlertService } from './telegram-alert.service';

class ClientErrorDto {
  @IsString()
  @MaxLength(1000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  stack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  context?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  appVersion?: string;
}

@ApiTags('monitoring')
@Controller('monitoring')
export class ClientErrorController {
  private readonly logger = new Logger('ClientError');

  constructor(private readonly tg: TelegramAlertService) {}

  @Post('client-error')
  @HttpCode(204)
  async report(@Body() dto: ClientErrorDto) {
    const platform = dto.platform ?? 'unknown';
    const isMobile = platform.toLowerCase().includes('ios')
      || platform.toLowerCase().includes('android')
      || platform.toLowerCase().includes('mobile');
    const emoji = isMobile ? '📱' : '🌐';
    const tag = isMobile ? 'MOBILE' : 'WEB';

    // Mobile clients tag warnings with a `[WARN]` prefix when shipping
    // expected-but-noteworthy events (e.g. transient billing-drift 404s
    // from old builds) through the same monitoring pipeline. Demote
    // those to logger.warn so they don't trip the JSON-log → Telegram
    // alert bridge that fires on `level: error`.
    const isClientWarning = /^\[WARN\]/i.test(dto.message);
    const logFn = isClientWarning ? this.logger.warn : this.logger.error;
    logFn.call(
      this.logger,
      `${emoji} Client ${isClientWarning ? 'Warning' : 'Error'} [${tag}] platform=${platform} ${dto.url ?? dto.context ?? ''}: ${dto.message}`,
      isClientWarning ? undefined : dto.stack ?? '',
    );

    // Skip expected client errors from Telegram alerts. The endpoint
    // accepts user-supplied content with no auth, so anything matched
    // against `dto.message` can be spoofed (an attacker could craft
    // "404 /ai/service-catalog ... <real error>" to hide a follow-up
    // failure). For URL-shaped suppression we anchor on the structured
    // `dto.url` field — same source of truth the logger already prints —
    // and require the mobile platform tag, both of which the client
    // sets directly via the API layer rather than embedding into a
    // free-form message string.
    const SKIP_BY_MESSAGE = [
      /401.*Unauthorized/i,
      /429.*Too Many/i,
      /ThrottlerException/i,
      /billing\/me.*401/i,
      /auth\/.*429/i,
      // Old client (≤1.3.21) BillingDrift check pings a 404'd legacy
      // endpoint and ships the failure as a [WARN] through this
      // controller. Already demoted to logger.warn above; also skip
      // the alert pipeline so the channel stays clean.
      /BillingDrift/i,
      /^\[WARN\]/i,
    ];
    const SKIP_BY_URL_MOBILE = [
      // 4xx on these endpoints is documented "service unknown" for
      // old mobile builds (≤1.3.21) that forwarded the raw smart-input
      // string as the service name. New builds guard on the client.
      /\/ai\/service-catalog(\/|$)/i,
      /\/ai\/lookup(\/|$)/i,
    ];
    const messageMatches = SKIP_BY_MESSAGE.some((p) => p.test(dto.message));
    const urlMatches =
      isMobile &&
      typeof dto.url === 'string' &&
      /\b(404|400|403)\b/.test(dto.message) &&
      SKIP_BY_URL_MOBILE.some((p) => p.test(dto.url ?? ''));
    const shouldAlert = !messageMatches && !urlMatches;

    if (shouldAlert) {
      const truncatedStack = dto.stack ? '\n\n<code>' + dto.stack.slice(0, 800) + '</code>' : '';
      const msg =
        `${emoji} <b>Runtime Error [${tag}]</b>\n` +
        `Platform: <code>${platform}</code>\n` +
        (dto.version ? `Version: <code>${dto.version}</code>\n` : '') +
        (dto.url ? `URL: <code>${dto.url}</code>\n` : '') +
        `\n<b>${dto.message}</b>` +
        truncatedStack;

      await this.tg.send(msg, dto.message);
    }
    return;
  }
}
