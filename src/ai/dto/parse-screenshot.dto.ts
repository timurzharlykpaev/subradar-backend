import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ParseScreenshotDto {
  @ApiProperty({ description: 'Base64-encoded image' })
  @IsString()
  imageBase64: string;
}
