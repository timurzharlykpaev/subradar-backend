import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery, ApiOperation } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CatalogService } from './catalog.service';
import { SearchCatalogDto } from './dto/search-catalog.dto';
import { seedRegionalPrices } from './seed-regional-prices.js';

@ApiTags('catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('popular')
  @ApiQuery({ name: 'region', required: false, example: 'KZ' })
  @ApiQuery({ name: 'currency', required: false, example: 'KZT' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getPopular(
    @Req() req: any,
    @Query('region') region?: string,
    @Query('currency') currency?: string,
    @Query('limit') limit?: number,
  ) {
    return this.catalog.getPopular(region, currency, limit, req.user);
  }

  @Post('seed-prices')
  @ApiOperation({ summary: 'Seed regional catalog prices (admin, one-time)' })
  async seedPrices() {
    await seedRegionalPrices(this.dataSource);
    return { ok: true, message: 'Regional prices seeded' };
  }

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
