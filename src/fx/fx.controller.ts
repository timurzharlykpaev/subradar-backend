import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FxService } from './fx.service';

@ApiTags('fx')
@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get('rates')
  async getRates() {
    return this.fx.getRates();
  }
}
