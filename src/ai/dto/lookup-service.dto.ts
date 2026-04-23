import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LookupServiceDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  query: string;

  @ApiPropertyOptional({ default: 'en' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiPropertyOptional({ default: 'US' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  country?: string;
}
