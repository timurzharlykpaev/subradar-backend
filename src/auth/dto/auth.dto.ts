import { IsEmail, IsString, MinLength, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  password: string;
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
}

export class LoginDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() password: string;
}

export class MagicLinkDto {
  @ApiProperty() @IsEmail() email: string;
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
