import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Req,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BillingService } from './billing.service';
import { UsersService } from '../users/users.service';

class CreateCheckoutDto {
  /** Lemon Squeezy variant id */
  @IsOptional() @IsString() variantId?: string;
  /** Alias used by web/mobile clients */
  @IsOptional() @IsString() planId?: string;
}

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly usersService: UsersService,
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
    return this.billingService.createCheckout(req.user.id, variantId, user.email);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('plans')
  getPlans() {
    return [];
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getBillingMe(@Request() req) {
    return this.usersService.findById(req.user.id).then((u) => ({
      plan: (u as any).plan || 'free',
      status: (u as any).subscriptionStatus || 'active',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    }));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('cancel')
  cancelBilling() {
    return { message: 'Cancellation requested' };
  }
}
