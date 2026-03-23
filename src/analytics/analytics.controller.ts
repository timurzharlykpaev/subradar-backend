import { Controller, Get, Post, Query, Body, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('summary')
  summary(
    @Request() req,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.getSummary(
      req.user.id,
      month ? +month : undefined,
      year ? +year : undefined,
    );
  }

  /** Alias for summary */
  @Get('home')
  home(
    @Request() req,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.getSummary(
      req.user.id,
      month ? +month : undefined,
      year ? +year : undefined,
    );
  }

  @Get('monthly')
  monthly(@Request() req, @Query('months') months?: string) {
    return this.service.getMonthly(req.user.id, months ? +months : 12);
  }

  /** Alias for monthly */
  @Get('trends')
  trends(@Request() req, @Query('months') months?: string) {
    return this.service.getMonthly(req.user.id, months ? +months : 12);
  }

  @Get('by-category')
  byCategory(
    @Request() req,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.getByCategory(
      req.user.id,
      month ? +month : undefined,
      year ? +year : undefined,
    );
  }

  /** Alias for by-category */
  @Get('categories')
  categories(
    @Request() req,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.getByCategory(
      req.user.id,
      month ? +month : undefined,
      year ? +year : undefined,
    );
  }

  @Get('upcoming')
  upcoming(@Request() req, @Query('days') days?: string) {
    return this.service.getUpcoming(req.user.id, days ? +days : 7);
  }

  @Get('by-card')
  byCard(@Request() req) {
    return this.service.getByCard(req.user.id);
  }

  @Get('trials')
  trials(@Request() req) {
    return this.service.getTrials(req.user.id);
  }

  @Get('forecast')
  async forecast(@Request() req) {
    return this.service.getForecast(req.user.id);
  }

  @Get('savings')
  async savings(@Request() req) {
    return this.service.getSavings(req.user.id);
  }

  /** Mobile uses POST /analytics/report — stub that delegates to reports service */
  @Post('report')
  generateReport(@Body() body: { startDate?: string; endDate?: string; type?: string }) {
    return { message: 'Use POST /reports/generate', received: body };
  }
}
