import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';

class LookupServiceDto {
  @IsString() query: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() country?: string;
}

class ParseScreenshotDto {
  @IsString() imageBase64: string;
}

class VoiceDto {
  @IsString() audioBase64: string;
  @IsOptional() @IsString() locale?: string;
}

class SuggestCancelDto {
  @IsString() serviceName: string;
}

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('lookup')
  lookup(@Body() dto: LookupServiceDto) {
    return this.aiService.lookupService(dto.query, dto.locale, dto.country);
  }

  @Post('parse-screenshot')
  parseScreenshot(@Body() dto: ParseScreenshotDto) {
    return this.aiService.parseScreenshot(dto.imageBase64);
  }

  @Post('voice')
  voice(@Body() dto: VoiceDto) {
    return this.aiService.voiceToSubscription(dto.audioBase64, dto.locale);
  }

  @Post('suggest-cancel')
  suggestCancel(@Body() dto: SuggestCancelDto) {
    return this.aiService.suggestCancelUrl(dto.serviceName);
  }
}
