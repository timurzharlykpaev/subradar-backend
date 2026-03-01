import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CardBrand } from '../entities/payment-card.entity';

export class CreatePaymentCardDto {
  @ApiProperty() @IsString() nickname: string;
  @ApiProperty() @IsString() @Length(4, 4) last4: string;
  @ApiPropertyOptional({ enum: CardBrand })
  @IsOptional()
  @IsEnum(CardBrand)
  brand?: CardBrand;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  color?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}
