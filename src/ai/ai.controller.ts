import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  Inject,
} from '@nestjs/common';
import { forwardRef } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { BillingService } from '../billing/billing.service';
import { WizardDto, MatchServiceDto } from './dto/ai.dto';

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
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() country?: string;
}

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    @Inject(forwardRef(() => BillingService))
    private readonly billingService: BillingService,
  ) {}

  @Post('lookup')
  async lookup(@Request() req, @Body() dto: LookupServiceDto) {
    await this.billingService.consumeAiRequest(req.user.id);
    return this.aiService.lookupService(dto.query, dto.locale, dto.country);
  }

  @Post('lookup-service')
  async lookupServiceAlias(@Request() req, @Body() dto: LookupServiceDto) {
    await this.billingService.consumeAiRequest(req.user.id);
    return this.aiService.lookupService(dto.query, dto.locale, dto.country);
  }

  @Post('search')
  async search(@Request() req, @Body() dto: LookupServiceDto) {
    await this.billingService.consumeAiRequest(req.user.id);
    return this.aiService.lookupService(dto.query, dto.locale, dto.country);
  }

  @Post('parse-screenshot')
  @UseInterceptors(FileInterceptor('file'))
  async parseScreenshot(
    @Request() req,
    @Body() dto: ParseScreenshotDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.billingService.consumeAiRequest(req.user.id);
    let imageBase64 = dto.imageBase64;
    if (!imageBase64 && file) {
      imageBase64 = file.buffer.toString('base64');
    }
    return this.aiService.parseScreenshot(imageBase64 || '');
  }

  @Post('voice')
  async voice(@Request() req, @Body() dto: VoiceDto) {
    await this.billingService.consumeAiRequest(req.user.id);
    return this.aiService.voiceToSubscription(dto.audioBase64 || '', dto.locale);
  }

  @Post('voice-to-subscription')
  @UseInterceptors(FileInterceptor('file'))
  async voiceToSubscriptionAlias(
    @Request() req,
    @Body() dto: VoiceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.billingService.consumeAiRequest(req.user.id);
    let audioBase64 = dto.audioBase64;
    if (!audioBase64 && file) {
      audioBase64 = file.buffer.toString('base64');
    }
    return this.aiService.voiceToSubscription(audioBase64 || '', dto.locale);
  }

  @Post('parse-audio')
  @UseInterceptors(FileInterceptor('file'))
  async parseAudio(
    @Request() req,
    @Body() dto: VoiceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.billingService.consumeAiRequest(req.user.id);
    let audioBase64 = dto.audioBase64;
    if (!audioBase64 && file) {
      audioBase64 = file.buffer.toString('base64');
    }
    if (!audioBase64) {
      return { text: '' };
    }
    return this.aiService.transcribeAudio(audioBase64, dto.locale);
  }

  @Post('parse-text')
  async parseText(@Request() req, @Body() dto: ParseTextDto) {
    await this.billingService.consumeAiRequest(req.user.id);
    return this.aiService.lookupService(dto.text);
  }

  @Post('match-service')
  async matchService(@Request() req, @Body() dto: MatchServiceDto) {
    await this.billingService.consumeAiRequest(req.user.id);
    return this.aiService.matchService(dto.name);
  }

  @Get('subscription-insights')
  async subscriptionInsights(@Request() req) {
    return this.aiService.getSubscriptionInsights(req.user.id);
  }

  @Post('run-audit')
  async runAudit(@Request() req) {
    await this.billingService.consumeAiRequest(req.user.id);
    return { success: true, reportId: null };
  }

  @Post('suggest-cancel')
  suggestCancel(@Body() dto: SuggestCancelDto) {
    return this.aiService.suggestCancelUrl(dto.serviceName);
  }

  /**
   * Parse MULTIPLE subscriptions from free text.
   * POST /ai/parse-bulk { text: "Netflix $15, Spotify $10, iCloud $3" }
   * Returns: { subscriptions: [...] }
   */
  @Post('parse-bulk')
  async parseBulk(@Request() req, @Body() dto: ParseTextDto) {
    await this.billingService.consumeAiRequest(req.user.id);
    const subscriptions = await this.aiService.parseBulkSubscriptions(dto.text, dto.locale ?? 'ru', dto.currency, dto.country);
    return { subscriptions, text: dto.text };
  }

  /**
   * Transcribe voice and parse multiple subscriptions.
   * POST /ai/voice-bulk { audioBase64?, locale? }
   * Returns: { text, subscriptions: [...] }
   */
  @Post('voice-bulk')
  @UseInterceptors(FileInterceptor('audio'))
  async voiceBulk(
    @Request() req,
    @Body() dto: VoiceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.billingService.consumeAiRequest(req.user.id);
    let audioBase64 = dto.audioBase64;
    if (!audioBase64 && file) {
      audioBase64 = file.buffer.toString('base64');
    }
    return this.aiService.voiceToBulkSubscriptions(audioBase64 || '', dto.locale ?? 'ru');
  }

  /**
   * Conversational AI wizard — drives the whole add-subscription dialog.
   * POST /ai/wizard { message, context?, locale? }
   * Returns: { done: true, subscription: {...} } OR { done: false, question, field, partialContext }
   */
  @Post('wizard')
  async wizard(@Request() req, @Body() dto: WizardDto) {
    await this.billingService.consumeAiRequest(req.user.id);
    return this.aiService.wizard(dto.message, dto.context ?? {}, dto.locale ?? 'en', (dto.history ?? []) as Array<{ role: 'user' | 'assistant'; content: string }>);
  }
}
