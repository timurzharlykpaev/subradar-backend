import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FxService } from './fx.service';

@ApiTags('fx')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get('rates')
  async getRates() {
    return this.fx.getRates();
  }
}
