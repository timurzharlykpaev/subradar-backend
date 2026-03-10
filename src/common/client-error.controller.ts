import { Controller, Post, Body, Logger, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength } from 'class-validator';

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
  platform?: string; // 'web' | 'mobile-ios' | 'mobile-android' | 'ios vX.X' etc.

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

  @Post('client-error')
  @HttpCode(204)
  report(@Body() dto: ClientErrorDto) {
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
    return;
  }
}
