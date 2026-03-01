import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LookupServiceDto {
  @ApiProperty()
  @IsString()
  query: string;

  @ApiPropertyOptional({ default: 'en' })
  @IsOptional()
  @IsString()
  locale?: string;

  @ApiPropertyOptional({ default: 'US' })
  @IsOptional()
  @IsString()
  country?: string;
}
