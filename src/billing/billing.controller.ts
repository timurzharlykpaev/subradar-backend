import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Headers,
  Req,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BillingService } from './billing.service';
import { UsersService } from '../users/users.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PLAN_DETAILS } from './plans.config';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';

class CreateCheckoutDto {
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsString() planId?: string;
  @IsOptional() @IsString() billing?: 'monthly' | 'yearly';
}

class InviteDto {
  @IsEmail() email: string;
}

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly usersService: UsersService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Post('webhook')
  async webhook(
    @Req() req: any,
    @Headers('x-signature') signature: string,
    @Body() body: any,
  ) {
    const rawBody = req.rawBody?.toString() || JSON.stringify(body);

    if (!this.billingService.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const event = body?.meta?.event_name;
    await this.billingService.handleWebhook(event, body?.data);
    return { received: true };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  async createCheckout(@Request() req, @Body() dto: CreateCheckoutDto) {
    const user = await this.usersService.findById(req.user.id);
    const variantId = dto.variantId || dto.planId || '';
    return this.billingService.createCheckout(req.user.id, variantId, user.email, dto.billing || 'monthly');
  }

  @Get('plans')
  getPlans() {
    return PLAN_DETAILS;
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getBillingMe(@Request() req) {
    const subs = await this.subscriptionsService.findAll(req.user.id);
    const activeCount = subs.filter(
      (s) => s.status === SubscriptionStatus.ACTIVE || s.status === SubscriptionStatus.TRIAL,
    ).length;
    return this.billingService.getBillingInfo(req.user.id, activeCount);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('trial')
  async startTrial(@Request() req) {
    await this.billingService.startTrial(req.user.id);
    return { success: true, message: 'Trial started. Enjoy 7 days of Pro!' };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('invite')
  async invite(@Request() req, @Body() dto: InviteDto) {
    await this.billingService.activateProInvite(req.user.id, dto.email);
    return { success: true, message: `Invite sent to ${dto.email}` };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('invite')
  async removeInvite(@Request() req) {
    await this.billingService.removeProInvite(req.user.id);
    return { success: true, message: 'Invite removed' };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('cancel')
  cancelBilling() {
    return { message: 'Cancellation requested' };
  }
}
