import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { FilterSubscriptionsDto } from './dto/filter-subscriptions.dto';
import { SubscriptionStatus } from './entities/subscription.entity';
import { ReceiptsService } from '../receipts/receipts.service';
import { SubscriptionLimitGuard, PLAN_LIMITS } from './guards/subscription-limit.guard';

@ApiTags('subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly service: SubscriptionsService,
    private readonly receiptsService: ReceiptsService,
  ) {}

  /** AI-parse stub — returns empty fields for now */
  @Post('ai-parse')
  aiParse(@Body() _body: { text?: string; imageBase64?: string }) {
    return {};
  }

  @Get('limits/check')
  async checkLimits(@Request() req: any) {
    const user = req.user;
    const plan = user.plan ?? 'free';
    const limits = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.free;

    const activeCount = await this.service.countActive(user.id);

    return {
      plan,
      subscriptions: {
        used: activeCount,
        max: limits.maxSubscriptions === Infinity ? null : limits.maxSubscriptions,
        limitReached:
          limits.maxSubscriptions !== null &&
          limits.maxSubscriptions !== Infinity &&
          activeCount >= (limits.maxSubscriptions ?? Infinity),
      },
      ai: {
        max: limits.maxAiRequests === Infinity ? null : limits.maxAiRequests,
      },
    };
  }

  // Cap bursty create traffic per IP/user on top of the plan-level limit
  // so no one can script-create thousands of subscriptions and blow up the
  // analysis/LLM pipeline or our mobile client memory.
  @Post()
  @UseGuards(SubscriptionLimitGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  create(@Request() req, @Body() dto: CreateSubscriptionDto) {
    return this.service.create(req.user.id, dto);
  }

  @Get()
  async findAll(
    @Request() req,
    @Query() filters: FilterSubscriptionsDto,
    @Query('displayCurrency') displayCurrencyQuery?: string,
  ) {
    return this.service.findAllWithDisplay(
      req.user.id,
      displayCurrencyQuery,
      filters,
    );
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.service.findOne(req.user.id, id);
  }

  @Patch(':id')
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: Partial<CreateSubscriptionDto>,
  ) {
    return this.service.update(req.user.id, id, dto);
  }

  /** PUT alias for mobile clients that use PUT instead of PATCH */
  @Put(':id')
  updatePut(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: Partial<CreateSubscriptionDto>,
  ) {
    return this.service.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.service.remove(req.user.id, id);
  }

  /** Cancel a subscription (set status to cancelled) */
  @Post(':id/cancel')
  cancel(@Request() req, @Param('id') id: string) {
    return this.service.updateStatus(req.user.id, id, SubscriptionStatus.CANCELLED);
  }

  /** Pause a subscription */
  @Post(':id/pause')
  pause(@Request() req, @Param('id') id: string) {
    return this.service.updateStatus(req.user.id, id, SubscriptionStatus.PAUSED);
  }

  /** Restore a paused/cancelled subscription to active */
  @Post(':id/restore')
  restore(@Request() req, @Param('id') id: string) {
    return this.service.updateStatus(req.user.id, id, SubscriptionStatus.ACTIVE);
  }

  /** Archive (soft delete) a subscription */
  @Post(':id/archive')
  archive(@Request() req, @Param('id') id: string) {
    return this.service.updateStatus(req.user.id, id, SubscriptionStatus.CANCELLED);
  }

  // ── Nested receipts routes ──────────────────────────────────────────────────

  @Get(':id/receipts')
  getReceipts(@Request() req, @Param('id') id: string) {
    return this.receiptsService.findBySubscription(req.user.id, id);
  }

  @Post(':id/receipts')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadReceipt(
    @Request() req,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.receiptsService.upload(req.user.id, file, id);
  }

  @Delete(':id/receipts/:receiptId')
  deleteReceipt(
    @Request() req,
    @Param('id') _id: string,
    @Param('receiptId') receiptId: string,
  ) {
    return this.receiptsService.remove(req.user.id, receiptId);
  }
}
