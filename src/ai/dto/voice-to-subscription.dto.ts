import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VoiceToSubscriptionDto {
  @ApiProperty({ description: 'Base64-encoded audio file' })
  @IsString()
  audioBase64: string;

  @ApiPropertyOptional({ default: 'en' })
  @IsOptional()
  @IsString()
  locale?: string;
}
