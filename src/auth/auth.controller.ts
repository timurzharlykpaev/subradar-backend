import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  Request,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import {
  RegisterDto,
  LoginDto,
  MagicLinkDto,
  RefreshTokenDto,
  AppleAuthDto,
  OtpSendDto,
  OtpVerifyDto,
  GoogleTokenDto,
  VerifyTokenDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { EmailThrottlerGuard } from './guards/email-throttler.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  // Per-email limits (5 per 15 min) — see EmailThrottlerGuard.
  @UseGuards(EmailThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // Credential-stuffing protection: 5 failed attempts per email per 15 min.
  @UseGuards(EmailThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {}

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Request() req, @Res() res: import('express').Response, @Query('state') state?: string) {
    const result = await this.authService.googleLogin(req.user);
    if (state === 'mobile') {
      // Mobile app: redirect to deep link so WebBrowser.openAuthSessionAsync catches it
      return res.redirect(
        `subradar://auth/callback?token=${result.accessToken}&refreshToken=${result.refreshToken}`,
      );
    }
    // Web app: redirect to frontend
    const frontendUrl = process.env.FRONTEND_URL || 'https://app.subradar.ai';
    return res.redirect(
      `${frontendUrl}/auth/callback#accessToken=${result.accessToken}&refreshToken=${result.refreshToken}`,
    );
  }

  @Post('google/token')
  googleTokenLogin(@Body() dto: GoogleTokenDto) {
    return this.authService.googleTokenLogin(
      dto.idToken || dto.accessToken || '',
    );
  }

  @Post('apple')
  appleLogin(@Body() dto: AppleAuthDto) {
    return this.authService.appleLogin(dto);
  }

  // OTP send throttled per-email to prevent SMS/email bombing a single user.
  @UseGuards(EmailThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('otp/send')
  sendOtp(@Body() dto: OtpSendDto) {
    return this.authService.sendOtp(dto);
  }

  // OTP verify throttled per-email to prevent code-guessing (10^6 space for
  // a 6-digit code is insufficient without rate limiting).
  @UseGuards(EmailThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('otp/verify')
  verifyOtp(@Body() dto: OtpVerifyDto) {
    return this.authService.verifyOtp(dto);
  }

  // Magic-link request per-email — matches the 5-per-15-min budget of OTP.
  @UseGuards(EmailThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('magic-link')
  sendMagicLink(@Body() dto: MagicLinkDto) {
    return this.authService.sendMagicLink(dto);
  }

  @Get('magic')
  verifyMagicLink(@Query('token') token: string) {
    return this.authService.verifyMagicLink(token);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@Request() req) {
    return this.authService.logout(req.user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Request() req) {
    return this.usersService.findById(req.user.id);
  }

  /** Alias: GET /auth/profile → same as /auth/me (used by mobile) */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req) {
    return this.usersService.findById(req.user.id);
  }

  /** Alias: PUT /auth/profile → update user (used by mobile) */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('profile')
  async updateProfile(
    @Request() req,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.update(req.user.id, dto);
  }

  /** Mobile uses POST /auth/google with {idToken} in body — delegate to googleTokenLogin */
  @Post('google/mobile')
  googleMobileLogin(@Body() dto: GoogleTokenDto) {
    return this.authService.googleTokenLogin(
      dto.idToken || dto.accessToken || '',
    );
  }

  /** Alias: POST /auth/verify with {token} — mobile's magic-link verification */
  @Post('verify')
  verifyMagicLinkPost(@Body() dto: VerifyTokenDto) {
    return this.authService.verifyMagicLink(dto.token);
  }
}
