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
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsDateString, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReportsService } from './reports.service';
import { ReportType } from './entities/report.entity';

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

  @Post('generate')
  generate(@Request() req, @Body() dto: GenerateReportDto) {
    const from = dto.from || dto.startDate || '';
    const to = dto.to || dto.endDate || '';
    return this.service.generate(req.user.id, from, to, dto.type);
  }

  @Get()
  findAll(@Request() req) {
    return this.service.findAll(req.user.id);
  }

  @Get(':id')
  async findOne(@Request() req, @Param('id') id: string) {
    const reports = await this.service.findAll(req.user.id);
    const report = reports.find((r: any) => r.id === id);
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  @Get(':id/download')
  async download(
    @Request() req,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.service.generatePdf(req.user.id, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="report-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
