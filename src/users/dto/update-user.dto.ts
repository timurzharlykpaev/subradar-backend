import {
  IsString,
  IsOptional,
  IsEmail,
  IsIn,
  IsBoolean,
  IsInt,
  Min,
  Max,
  Length,
  Matches,
} from 'class-validator';
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

  // The fields below are all whitelisted on UsersService.update but were
  // missing from this DTO. With the global ValidationPipe running
  // `forbidNonWhitelisted: true`, any client (including older App Store
  // builds and the web app) that PATCHes /users/me with one of these
  // got a 400 instead of having the value persisted. Declaring them
  // here as optional restores backward-compatible behaviour additively —
  // no field is required, so clients that omit them keep the old
  // semantics. See commit 71e9222 (the tightening that introduced the
  // regression).
  @ApiPropertyOptional({ description: 'Mark the first-run onboarding as finished' })
  @IsOptional()
  @IsBoolean()
  onboardingCompleted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  weeklyDigestEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Days before renewal to send a reminder (0–30)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  reminderDaysBefore?: number;
}
