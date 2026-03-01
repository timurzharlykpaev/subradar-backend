import { IsDateString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ReportType } from '../entities/report.entity';

export class GenerateReportDto {
  @ApiProperty({ example: '2024-01-01' })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2024-12-31' })
  @IsDateString()
  to: string;

  @ApiProperty({ enum: ReportType })
  @IsEnum(ReportType)
  type: ReportType;
}
