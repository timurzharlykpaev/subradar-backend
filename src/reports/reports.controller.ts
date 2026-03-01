import { Controller, Post, Get, Param, Body, UseGuards, Request, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, IsEnum, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReportsService } from './reports.service';
import { ReportType } from './entities/report.entity';

class GenerateReportDto {
  @ApiProperty() @IsDateString() from: string;
  @ApiProperty() @IsDateString() to: string;
  @ApiProperty({ enum: ReportType }) @IsEnum(ReportType) type: ReportType;
}

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Post('generate')
  generate(@Request() req, @Body() dto: GenerateReportDto) {
    return this.service.generate(req.user.id, dto.from, dto.to, dto.type);
  }

  @Get()
  findAll(@Request() req) {
    return this.service.findAll(req.user.id);
  }

  @Get(':id/download')
  async download(@Request() req, @Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.generatePdf(req.user.id, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="report-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
