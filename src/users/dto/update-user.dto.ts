import { IsString, IsOptional, IsEmail, IsIn, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fcmToken?: string;

  @ApiPropertyOptional({ description: 'ISO-3166 alpha-2 country code' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, { message: 'region must be ISO-3166 alpha-2' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  region?: string;

  @ApiPropertyOptional({ description: 'ISO-4217 currency code for display' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'displayCurrency must be ISO-4217' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  displayCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezoneDetected?: string;

  // Whitelisted on UsersService.update — listing here so the strict
  // ValidationPipe (whitelist + forbidNonWhitelisted) doesn't drop the
  // value when the mobile Settings screen mirrors a date-format choice.
  // Restricted to the three formats the mobile UI offers; anything else
  // gets a 400 instead of silently corrupting the field.
  @ApiPropertyOptional({ enum: ['DD/MM', 'MM/DD', 'YYYY-MM-DD'] })
  @IsOptional()
  @IsString()
  @IsIn(['DD/MM', 'MM/DD', 'YYYY-MM-DD'])
  dateFormat?: string;
}
