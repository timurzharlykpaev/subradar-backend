import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
  Res,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsDateString, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReportsService } from './reports.service';
import { ReportType, ReportStatus } from './entities/report.entity';

class GenerateReportDto {
  /** ISO date string — primary field */
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  /** Alias used by web/mobile clients */
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  /** Alias used by web/mobile clients */
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiProperty({ enum: ReportType }) @IsEnum(ReportType) type: ReportType;
  /** Optional format hint (pdf | csv) — ignored server-side for now */
  @ApiPropertyOptional() @IsOptional() @IsString() format?: string;
}

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  /**
   * Enqueue a new report for async PDF generation.
   * Returns the report with status=PENDING immediately.
   */
  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  generate(@Request() req, @Body() dto: GenerateReportDto) {
    const from = dto.from || dto.startDate || '';
    const to = dto.to || dto.endDate || '';
    return this.service.generate(req.user.id, from, to, dto.type);
  }

  @Get()
  findAll(@Request() req) {
    return this.service.findAll(req.user.id);
  }

  /**
   * Get a single report (includes current status: PENDING / GENERATING / READY / FAILED).
   */
  @Get(':id')
  async findOne(@Request() req, @Param('id') id: string) {
    return this.service.findOne(req.user.id, id);
  }

  /**
   * Download the generated PDF.
   * Returns 404 if the report is not READY or the PDF has expired in Redis.
   */
  @Get(':id/download')
  async download(
    @Request() req,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.service.downloadPdf(req.user.id, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="report-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
