import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsISO8601, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ParseBulkInputMessageDto {
  @IsString()
  @MaxLength(255)
  id: string;

  @IsString()
  @MaxLength(500)
  subject: string;

  @IsString()
  @MaxLength(4000)
  snippet: string;

  // The `From` header may contain `Name <a@b.com>`, accept any string to avoid
  // false rejections; we'll only use it for downstream display, not as identity.
  @IsString()
  @MaxLength(320)
  from: string;

  @IsISO8601()
  receivedAt: string;
}

export class ParseBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(800)
  @ValidateNested({ each: true })
  @Type(() => ParseBulkInputMessageDto)
  messages: ParseBulkInputMessageDto[];

  @IsString()
  @MaxLength(10)
  locale: string;
}
