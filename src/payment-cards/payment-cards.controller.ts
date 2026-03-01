import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentCardsService } from './payment-cards.service';
import { CreatePaymentCardDto } from './dto/create-payment-card.dto';

@ApiTags('payment-cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payment-cards')
export class PaymentCardsController {
  constructor(private readonly service: PaymentCardsService) {}

  @Post()
  create(@Request() req, @Body() dto: CreatePaymentCardDto) {
    return this.service.create(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req) {
    return this.service.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.service.findOne(req.user.id, id);
  }

  @Patch(':id')
  update(@Request() req, @Param('id') id: string, @Body() dto: Partial<CreatePaymentCardDto>) {
    return this.service.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.service.remove(req.user.id, id);
  }
}
