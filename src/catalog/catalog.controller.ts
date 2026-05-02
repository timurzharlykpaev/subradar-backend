import { Controller, ForbiddenException, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiQuery, ApiOperation } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CatalogService } from './catalog.service';
import { SearchCatalogDto } from './dto/search-catalog.dto';
import { seedRegionalPrices } from './seed-regional-prices.js';
import { UsersService } from '../users/users.service';
import { AuditService } from '../common/audit/audit.service';

@ApiTags('catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly audit: AuditService,
  ) {}

  private async assertAdmin(userId: string): Promise<void> {
    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (adminEmails.length === 0) {
      throw new ForbiddenException('Admin access not configured');
    }
    const user = await this.usersService.findById(userId).catch(() => null);
    if (!user || !adminEmails.includes(user.email.toLowerCase())) {
      throw new ForbiddenException('Admin access required');
    }
  }

  @Get('popular')
  @ApiQuery({ name: 'region', required: false, example: 'KZ' })
  @ApiQuery({ name: 'currency', required: false, example: 'KZT' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getPopular(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
    @Query('region') region?: string,
    @Query('currency') currency?: string,
    @Query('limit') limit?: number,
  ) {
    // Edge caching is only safe when both region and currency are
    // EXPLICIT in the URL — then the cache key (full URL) deterministically
    // identifies the response. If either falls back to the JWT user's
    // saved prefs (`catalog.service.ts` does this when params are
    // omitted), the response varies per caller and a public CDN entry
    // would leak one user's regional data to another. Keep the fallback
    // for backward compatibility with old App Store binaries; just don't
    // let CF cache that branch.
    if (region && currency) {
      res.setHeader(
        'Cache-Control',
        'public, max-age=300, s-maxage=3600, stale-while-revalidate=600',
      );
    } else {
      res.setHeader('Cache-Control', 'private, max-age=60');
    }
    return this.catalog.getPopular(region, currency, limit, req.user);
  }

  @Post('seed-prices')
  @ApiOperation({ summary: 'Seed regional catalog prices (admin, one-time)' })
  async seedPrices(@Req() req: any) {
    await this.assertAdmin(req.user.id);
    await seedRegionalPrices(this.dataSource);
    await this.audit.log({
      userId: req.user.id,
      action: 'admin.catalog.seed_prices',
      resourceType: 'catalog',
      metadata: null,
      ipAddress:
        (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.ip ||
        null,
      userAgent: (req.headers?.['user-agent'] as string) || null,
    });
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
