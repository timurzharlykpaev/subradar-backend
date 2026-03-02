import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  @IsOptional() @IsString() imageBase64?: string;
}

class VoiceDto {
  @IsOptional() @IsString() audioBase64?: string;
  @IsOptional() @IsString() locale?: string;
}

class SuggestCancelDto {
  @IsString() serviceName: string;
}

class ParseTextDto {
  @IsString() text: string;
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

  /** Alias used by web client */
  @Post('lookup-service')
  lookupServiceAlias(@Body() dto: LookupServiceDto) {
    return this.aiService.lookupService(dto.query, dto.locale, dto.country);
  }

  /** Alias used by mobile client */
  @Post('search')
  search(@Body() dto: LookupServiceDto) {
    return this.aiService.lookupService(dto.query, dto.locale, dto.country);
  }

  /**
   * Accepts either:
   *  - JSON body: { imageBase64: string }
   *  - multipart/form-data: file field named "file"
   */
  @Post('parse-screenshot')
  @UseInterceptors(FileInterceptor('file'))
  async parseScreenshot(
    @Body() dto: ParseScreenshotDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let imageBase64 = dto.imageBase64;
    if (!imageBase64 && file) {
      imageBase64 = file.buffer.toString('base64');
    }
    return this.aiService.parseScreenshot(imageBase64 || '');
  }

  @Post('voice')
  voice(@Body() dto: VoiceDto) {
    return this.aiService.voiceToSubscription(dto.audioBase64 || '', dto.locale);
  }

  /** Alias used by mobile client */
  @Post('voice-to-subscription')
  @UseInterceptors(FileInterceptor('file'))
  async voiceToSubscriptionAlias(
    @Body() dto: VoiceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let audioBase64 = dto.audioBase64;
    if (!audioBase64 && file) {
      audioBase64 = file.buffer.toString('base64');
    }
    return this.aiService.voiceToSubscription(audioBase64 || '', dto.locale);
  }

  /** Alias used by mobile client */
  @Post('parse-audio')
  @UseInterceptors(FileInterceptor('file'))
  async parseAudio(
    @Body() dto: VoiceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let audioBase64 = dto.audioBase64;
    if (!audioBase64 && file) {
      audioBase64 = file.buffer.toString('base64');
    }
    return this.aiService.voiceToSubscription(audioBase64 || '', dto.locale);
  }

  /** Parse plain text description into subscription fields */
  @Post('parse-text')
  parseText(@Body() dto: ParseTextDto) {
    return this.aiService.lookupService(dto.text);
  }

  @Post('suggest-cancel')
  suggestCancel(@Body() dto: SuggestCancelDto) {
    return this.aiService.suggestCancelUrl(dto.serviceName);
  }
}
