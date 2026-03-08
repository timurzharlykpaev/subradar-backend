import { Controller, Post, Body, Logger, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

class ClientErrorDto {
  message: string;
  stack?: string;
  url?: string;
  platform?: string; // 'web' | 'mobile'
  version?: string;
}

@ApiTags('monitoring')
@Controller('monitoring')
export class ClientErrorController {
  private readonly logger = new Logger('ClientError');

  @Post('client-error')
  @HttpCode(204)
  report(@Body() dto: ClientErrorDto) {
    const platform = dto.platform ?? 'web';
    const emoji = platform === 'mobile' ? '📱' : '🌐';
    this.logger.error(
      `${emoji} Client Error [${platform.toUpperCase()}] ${dto.url ?? ''}: ${dto.message}`,
      dto.stack ?? '',
    );
    return;
  }
}
