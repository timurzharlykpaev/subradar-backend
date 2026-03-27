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

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {}

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Request() req, @Res() res: import('express').Response) {
    const result = await this.authService.googleLogin(req.user);
    const frontendUrl = process.env.FRONTEND_URL || 'https://app.subradar.ai';
    return res.redirect(
      `${frontendUrl}/auth/callback?accessToken=${result.accessToken}&refreshToken=${result.refreshToken}`,
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

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('otp/send')
  sendOtp(@Body() dto: OtpSendDto) {
    return this.authService.sendOtp(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('otp/verify')
  verifyOtp(@Body() dto: OtpVerifyDto) {
    return this.authService.verifyOtp(dto);
  }

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
