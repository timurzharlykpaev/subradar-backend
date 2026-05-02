import { Controller, Get, Header, UseGuards } from '@nestjs/common';
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
  // FX rates refresh server-side every 6 h. 2 min browser, 5 min CDN —
  // means ~1/30th of users hit the origin. The rates are identical for
  // every user so caching is safe; the response carries no PII.
  @Header('Cache-Control', 'public, max-age=120, s-maxage=300, stale-while-revalidate=600')
  async getRates() {
    return this.fx.getRates();
  }
}
