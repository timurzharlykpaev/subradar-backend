import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty() @IsEmail() email: string;
  // Password rules updated per ASVS V2.1.1 + V2.1.9: minimum length 12,
  // composition rules removed (forced upper/lower/digit explicitly forbidden
  // by ASVS V2.1.9 — they reduce entropy and push users to predictable
  // patterns). Length is the only enforced rule. Existing users with
  // shorter bcrypt-hashed passwords keep working — this only applies to
  // NEW registrations. To rotate existing weak passwords, push them
  // through the magic-link/OTP flow on next login.
  @ApiProperty({
    minLength: 12,
    description: 'Minimum 12 characters. No composition rules.',
  })
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters long' })
  password: string;
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
}

export class LoginDto {
  @ApiProperty() @IsEmail() email: string;
  // No MinLength on login — old users may still have an 8-char password
  // from before the V2.1.1 policy change. Reject only at bcrypt.compare.
  @ApiProperty() @IsString() password: string;
}

export class MagicLinkDto {
  @ApiProperty() @IsEmail() email: string;
  /** ISO-639 locale of the requesting client (en/ru/es/de/fr/pt/zh/ja/ko/kk).
   * Drives email subject + body language. Falls back to `en` when missing. */
  @ApiPropertyOptional() @IsOptional() @IsString() locale?: string;
}

export class RefreshTokenDto {
  @ApiProperty() @IsString() refreshToken: string;
}

export class AppleAuthDto {
  @ApiProperty() @IsString() idToken: string;
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
}

export class OtpSendDto {
  @ApiProperty() @IsEmail() email: string;
  /** ISO-639 locale of the requesting client. Drives email subject + body. */
  @ApiPropertyOptional() @IsOptional() @IsString() locale?: string;
}

export class OtpVerifyDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() code: string;
}

export class GoogleTokenDto {
  @ApiPropertyOptional() @IsOptional() @IsString() idToken?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accessToken?: string;
}

export class VerifyTokenDto {
  @ApiProperty() @IsString() token: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() avatarUrl?: string;
}
