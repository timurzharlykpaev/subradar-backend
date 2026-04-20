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
  Param,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { forwardRef } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { BillingService } from '../billing/billing.service';
import { MarketDataService } from '../analysis/market-data.service';
import { WizardDto, MatchServiceDto } from './dto/ai.dto';

function isValidImage(buffer: Buffer): boolean {
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return true;
  // GIF: 47 49 46
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return true;
  return false;
}

function isValidAudio(buffer: Buffer): boolean {
  // ID3 (MP3): 49 44 33
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return true;
  // OGG: 4F 67 67 53
  if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) return true;
  // RIFF/WAV/WebM: 52 49 46 46
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return true;
  // ftyp (M4A/MP4): offset 4-7 = 66 74 79 70
  if (buffer.length > 7 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) return true;
  // FLAC: 66 4C 61 43
  if (buffer[0] === 0x66 && buffer[1] === 0x4C && buffer[2] === 0x61 && buffer[3] === 0x43) return true;
  return false;
}

class LookupServiceDto {
  @IsString() query: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() currency?: string;
}

class ParseScreenshotDto {
  @IsOptional() @IsString() imageBase64?: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() country?: string;
}

class VoiceDto {
  @IsOptional() @IsString() audioBase64?: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() country?: string;
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

/**
 * Resolve locale/currency/country from request DTO with fallback to authenticated
 * user's profile. Guarantees AI prompts always have these signals even if the
 * frontend forgets to forward them.
 */
function resolveLocaleContext(
  req: any,
  dto: { locale?: string; currency?: string; country?: string } = {},
): { locale: string; currency: string; country: string } {
  const u = req?.user || {};
  return {
    locale: dto.locale || u.locale || 'en',
    currency: dto.currency || u.displayCurrency || u.defaultCurrency || 'USD',
    country: dto.country || u.region || u.country || 'US',
  };
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
    private readonly marketDataService: MarketDataService,
  ) {}

  @Post('lookup')
  async lookup(@Request() req, @Body() dto: LookupServiceDto) {
    await this.billingService.consumeAiRequest(req.user.id);
    const ctx = resolveLocaleContext(req, dto);
    return this.aiService.lookupService(dto.query, ctx);
  }

  @Post('lookup-service')
  async lookupServiceAlias(@Request() req, @Body() dto: LookupServiceDto) {
    await this.billingService.consumeAiRequest(req.user.id);
    const ctx = resolveLocaleContext(req, dto);
    return this.aiService.lookupService(dto.query, ctx);
  }

  @Post('search')
  async search(@Request() req, @Body() dto: LookupServiceDto) {
    await this.billingService.consumeAiRequest(req.user.id);
    const ctx = resolveLocaleContext(req, dto);
    return this.aiService.lookupService(dto.query, ctx);
  }

  @Post('parse-screenshot')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files allowed'), false);
      cb(null, true);
    },
  }))
  async parseScreenshot(
    @Request() req,
    @Body() dto: ParseScreenshotDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.billingService.consumeAiRequest(req.user.id);
    if (file?.buffer && !isValidImage(file.buffer)) {
      throw new BadRequestException('Invalid image file');
    }
    let imageBase64 = dto.imageBase64;
    if (!imageBase64 && file) {
      imageBase64 = file.buffer.toString('base64');
    }
    const ctx = resolveLocaleContext(req, dto);
    return this.aiService.parseScreenshot(imageBase64 || '', ctx);
  }

  @Post('voice')
  async voice(@Request() req, @Body() dto: VoiceDto) {
    await this.billingService.consumeAiRequest(req.user.id);
    const ctx = resolveLocaleContext(req, dto);
    return this.aiService.voiceToSubscription(dto.audioBase64 || '', ctx);
  }

  @Post('voice-to-subscription')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('audio/')) return cb(new Error('Only audio files allowed'), false);
      cb(null, true);
    },
  }))
  async voiceToSubscriptionAlias(
    @Request() req,
    @Body() dto: VoiceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.billingService.consumeAiRequest(req.user.id);
    if (file?.buffer && !isValidAudio(file.buffer)) {
      throw new BadRequestException('Invalid audio file');
    }
    let audioBase64 = dto.audioBase64;
    if (!audioBase64 && file) {
      audioBase64 = file.buffer.toString('base64');
    }
    const ctx = resolveLocaleContext(req, dto);
    return this.aiService.voiceToSubscription(audioBase64 || '', ctx);
  }

  @Post('parse-audio')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('audio/')) return cb(new Error('Only audio files allowed'), false);
      cb(null, true);
    },
  }))
  async parseAudio(
    @Request() req,
    @Body() dto: VoiceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.billingService.consumeAiRequest(req.user.id);
    if (file?.buffer && !isValidAudio(file.buffer)) {
      throw new BadRequestException('Invalid audio file');
    }
    let audioBase64 = dto.audioBase64;
    if (!audioBase64 && file) {
      audioBase64 = file.buffer.toString('base64');
    }
    if (!audioBase64) {
      return { text: '' };
    }
    const ctx = resolveLocaleContext(req, dto);
    return this.aiService.transcribeAudio(audioBase64, ctx.locale);
  }

  @Post('parse-text')
  async parseText(@Request() req, @Body() dto: ParseTextDto) {
    await this.billingService.consumeAiRequest(req.user.id);
    const ctx = resolveLocaleContext(req, dto);
    return this.aiService.lookupService(dto.text, ctx);
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
  @UseGuards(JwtAuthGuard)
  async suggestCancel(@Request() req, @Body() dto: SuggestCancelDto) {
    await this.billingService.consumeAiRequest(req.user.id);
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
    const ctx = resolveLocaleContext(req, dto);
    const subscriptions = await this.aiService.parseBulkSubscriptions(dto.text, ctx.locale, ctx.currency, ctx.country);
    return { subscriptions, text: dto.text };
  }

  /**
   * Transcribe voice and parse multiple subscriptions.
   * POST /ai/voice-bulk { audioBase64?, locale? }
   * Returns: { text, subscriptions: [...] }
   */
  @Post('voice-bulk')
  @UseInterceptors(FileInterceptor('audio', {
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('audio/')) return cb(new Error('Only audio files allowed'), false);
      cb(null, true);
    },
  }))
  async voiceBulk(
    @Request() req,
    @Body() dto: VoiceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.billingService.consumeAiRequest(req.user.id);
    if (file?.buffer && !isValidAudio(file.buffer)) {
      throw new BadRequestException('Invalid audio file');
    }
    let audioBase64 = dto.audioBase64;
    if (!audioBase64 && file) {
      audioBase64 = file.buffer.toString('base64');
    }
    const ctx = resolveLocaleContext(req, dto);
    return this.aiService.voiceToBulkSubscriptions(audioBase64 || '', ctx.locale, ctx.currency, ctx.country);
  }

  /**
   * Conversational AI wizard — drives the whole add-subscription dialog.
   * POST /ai/wizard { message, context?, locale? }
   * Returns: { done: true, subscription: {...} } OR { done: false, question, field, partialContext }
   */
  @Post('wizard')
  async wizard(@Request() req, @Body() dto: WizardDto) {
    await this.billingService.consumeAiRequest(req.user.id);
    const ctx = resolveLocaleContext(req, { locale: dto.locale });
    // Server-side guarantee: even if the frontend forgets to pass currency/country
    // through `context`, derive them from the authenticated user's profile so the
    // wizard prompt always knows the user's monetary frame.
    const userCtx = req?.user || {};
    const fallbackCurrency = userCtx.displayCurrency || userCtx.defaultCurrency || 'USD';
    const fallbackCountry = userCtx.region || userCtx.country || 'US';
    const mergedContext = {
      ...(dto.context ?? {}),
      preferredCurrency: (dto.context as any)?.preferredCurrency || fallbackCurrency,
      userCountry: (dto.context as any)?.userCountry || fallbackCountry,
    };
    return this.aiService.wizard(dto.message, mergedContext, ctx.locale, (dto.history ?? []) as Array<{ role: 'user' | 'assistant'; content: string }>);
  }

  /**
   * Free DB-only service catalog lookup — no AI call, no billing consumption.
   * GET /ai/service-catalog/:serviceName
   * Returns: { name, category, iconUrl, serviceUrl, cancelUrl, plans }
   */
  @Get('service-catalog/:serviceName')
  async serviceCatalogLookup(@Param('serviceName') serviceName: string) {
    const normalized = this.marketDataService.normalizeServiceName(serviceName);
    const entry = await this.marketDataService.getMarketData(normalized, false);

    if (!entry) {
      throw new NotFoundException({ error: 'NOT_FOUND' });
    }

    return {
      name: entry.displayName,
      category: entry.category,
      iconUrl: entry.logoUrl || `https://icon.horse/icon/${normalized.replace(/_/g, '')}.com`,
      serviceUrl: null,
      cancelUrl: null,
      plans: entry.plans,
    };
  }
}
