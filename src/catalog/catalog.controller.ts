import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CatalogService } from './catalog.service';
import { SearchCatalogDto } from './dto/search-catalog.dto';

@ApiTags('catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('search')
  async search(@Query() dto: SearchCatalogDto) {
    const { service, plans } = await this.catalog.search(dto.q, dto.region);
    return [
      {
        serviceId: service.id,
        name: service.name,
        slug: service.slug,
        category: service.category,
        iconUrl: service.iconUrl,
        websiteUrl: service.websiteUrl,
        plans: plans.map((p) => ({
          planId: p.id,
          planName: p.planName,
          price: parseFloat(p.price),
          currency: p.currency,
          period: p.period,
          features: p.features,
          confidence: p.priceConfidence,
        })),
      },
    ];
  }
}
