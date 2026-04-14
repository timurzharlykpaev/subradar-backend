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

    this.logger.error(
      `${emoji} Client Error [${tag}] platform=${platform} ${dto.url ?? dto.context ?? ''}: ${dto.message}`,
      dto.stack ?? '',
    );

    // Skip expected client errors from Telegram alerts
    const SKIP_TELEGRAM = [
      /401.*Unauthorized/i,
      /429.*Too Many/i,
      /ThrottlerException/i,
      /billing\/me.*401/i,
      /auth\/.*429/i,
    ];
    const shouldAlert = !SKIP_TELEGRAM.some((p) => p.test(dto.message));

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
