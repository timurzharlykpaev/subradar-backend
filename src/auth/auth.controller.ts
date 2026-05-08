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

// Extract IP + UA from the express request for audit-log enrichment.
// Honour X-Forwarded-For when present (DO App Platform terminates TLS at
// the LB and forwards the original client IP). Trust only the leftmost
// hop — anything else may be attacker-controlled.
function ctxFromReq(req: any): { ipAddress?: string; userAgent?: string } {
  const xff = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0]?.trim();
  const ipAddress = xff || req?.ip || req?.connection?.remoteAddress || undefined;
  const userAgent = String(req?.headers?.['user-agent'] || '').slice(0, 500) || undefined;
  return { ipAddress, userAgent };
}

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
  register(@Request() req, @Body() dto: RegisterDto) {
    return this.authService.register(dto, ctxFromReq(req));
  }

  // Credential-stuffing protection: 5 failed attempts per email per 15 min.
  @UseGuards(EmailThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('login')
  login(@Request() req, @Body() dto: LoginDto) {
    return this.authService.login(dto, ctxFromReq(req));
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {}

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Request() req, @Res() res: import('express').Response, @Query('state') state?: string) {
    const result = await this.authService.googleLogin(req.user, ctxFromReq(req));
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

  /**
   * Hardened OAuth callback (V13.1.3 / ASVS V3.2.3): tokens are placed in
   * the URL fragment (`#token=...`) instead of the query string, even for
   * the mobile deep-link branch. Fragments never reach server access logs,
   * referrer headers, or — for `subradar://...` — Expo's WebBrowser /
   * iOS CFNetwork OS-level URL logs. The legacy `/google/callback` endpoint
   * above is kept rendering tokens in query so old App Store builds keep
   * working until adoption clears (~6-8 weeks); newer mobile builds and the
   * web app should target this endpoint.
   *
   * To migrate: register
   *   https://api.subradar.ai/api/v1/auth/google/callback/v2
   * as an authorised redirect URI in Google Cloud Console, point the next
   * mobile build's GoogleAuth config at it, and once App Store adoption
   * crosses ~95% delete the legacy endpoint above.
   */
  @Get('google/callback/v2')
  @UseGuards(GoogleAuthGuard)
  async googleCallbackV2(
    @Request() req,
    @Res() res: import('express').Response,
    @Query('state') state?: string,
  ) {
    const result = await this.authService.googleLogin(
      req.user,
      ctxFromReq(req),
    );
    const frag = `accessToken=${encodeURIComponent(result.accessToken)}&refreshToken=${encodeURIComponent(result.refreshToken)}`;
    if (state === 'mobile') {
      return res.redirect(`subradar://auth/callback#${frag}`);
    }
    const frontendUrl = process.env.FRONTEND_URL || 'https://app.subradar.ai';
    return res.redirect(`${frontendUrl}/auth/callback#${frag}`);
  }

  @Post('google/token')
  googleTokenLogin(@Request() req, @Body() dto: GoogleTokenDto) {
    return this.authService.googleTokenLogin(
      dto.idToken || dto.accessToken || '',
      ctxFromReq(req),
    );
  }

  @Post('apple')
  appleLogin(@Request() req, @Body() dto: AppleAuthDto) {
    return this.authService.appleLogin(dto, ctxFromReq(req));
  }

  // OTP send throttled per-email to prevent SMS/email bombing a single user.
  @UseGuards(EmailThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('otp/send')
  sendOtp(@Request() req, @Body() dto: OtpSendDto) {
    return this.authService.sendOtp(dto, ctxFromReq(req));
  }

  // OTP verify throttled per-email to prevent code-guessing (10^6 space for
  // a 6-digit code is insufficient without rate limiting).
  @UseGuards(EmailThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('otp/verify')
  verifyOtp(@Request() req, @Body() dto: OtpVerifyDto) {
    return this.authService.verifyOtp(dto, ctxFromReq(req));
  }

  // Magic-link request per-email — matches the 5-per-15-min budget of OTP.
  @UseGuards(EmailThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('magic-link')
  sendMagicLink(@Request() req, @Body() dto: MagicLinkDto) {
    return this.authService.sendMagicLink(dto, ctxFromReq(req));
  }

  @Get('magic')
  verifyMagicLink(@Request() req, @Query('token') token: string) {
    return this.authService.verifyMagicLink(token, ctxFromReq(req));
  }

  @Post('refresh')
  refresh(@Request() req, @Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken, ctxFromReq(req));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@Request() req) {
    return this.authService.logout(req.user.id, ctxFromReq(req));
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
