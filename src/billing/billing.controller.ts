import {
  Controller, Post, Body, Headers, Req,
  UseGuards, Request, BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BillingService } from './billing.service';
import { UsersService } from '../users/users.service';

class CreateCheckoutDto {
  @IsString() variantId: string;
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
    return this.billingService.createCheckout(req.user.id, dto.variantId, user.email);
  }
}
