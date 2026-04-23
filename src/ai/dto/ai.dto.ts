import { IsString, IsOptional, IsArray, ValidateNested, MaxLength, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class WizardHistoryItemDto {
  @IsString()
  @MaxLength(32)
  role: string;

  @IsString()
  @MaxLength(4000)
  content: string;
}

export class WizardDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  message: string;

  @ApiPropertyOptional()
  @IsOptional()
  context?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WizardHistoryItemDto)
  history?: WizardHistoryItemDto[];
}

export class MatchServiceDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name: string;
}
