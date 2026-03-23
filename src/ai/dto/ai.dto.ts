import { IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class WizardHistoryItemDto {
  @IsString() role: string;
  @IsString() content: string;
}

export class WizardDto {
  @ApiProperty()
  @IsString()
  message: string;

  @ApiPropertyOptional()
  @IsOptional()
  context?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WizardHistoryItemDto)
  history?: WizardHistoryItemDto[];
}

export class MatchServiceDto {
  @ApiProperty()
  @IsString()
  name: string;
}
