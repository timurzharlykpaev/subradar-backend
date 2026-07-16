import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { TelegramAlertService } from './telegram-alert.service';

/**
 * Public lead capture for the `subradar.ai/get` bio link. Android/desktop
 * visitors (SubRadar is iOS-only for now) leave an email to be notified at the
 * Android launch. No DB — each lead is pushed to the ops Telegram channel via
 * the existing alert service, deduped so a double-submit doesn't double-ping.
 * Additive + public; no auth, so it's rate-limited.
 */
class WaitlistDto {
  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  source?: string;
}

@ApiTags('waitlist')
@Controller('waitlist')
export class WaitlistController {
  private readonly logger = new Logger('Waitlist');

  constructor(private readonly tg: TelegramAlertService) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async join(@Body() dto: WaitlistDto): Promise<{ ok: true }> {
    const email = dto.email.trim().toLowerCase();
    const platform = dto.platform ?? 'android';
    const source = dto.source ?? 'get';
    this.logger.log(`waitlist signup: ${email} (${platform}, ${source})`);
    // dedupKey on the email → the same address re-submitting won't spam the
    // channel within the dedup window.
    await this.tg.send(
      `📝 Waitlist signup\n${email}\nplatform: ${platform} · source: ${source}`,
      `waitlist:${email}`,
    );
    return { ok: true };
  }
}
