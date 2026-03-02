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
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import {
  RegisterDto,
  LoginDto,
  MagicLinkDto,
  RefreshTokenDto,
  AppleAuthDto,
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
  googleTokenLogin(@Body() body: { idToken?: string; accessToken?: string }) {
    return this.authService.googleTokenLogin(
      body.idToken || body.accessToken || '',
    );
  }

  @Post('apple')
  appleLogin(@Body() dto: AppleAuthDto) {
    return this.authService.appleLogin(dto);
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
    @Body() body: Partial<{ name: string; avatarUrl: string }>,
  ) {
    return this.usersService.update(req.user.id, body);
  }

  /** Mobile uses POST /auth/google with {idToken} in body — delegate to googleTokenLogin */
  @Post('google/mobile')
  googleMobileLogin(@Body() body: { idToken?: string; accessToken?: string }) {
    return this.authService.googleTokenLogin(
      body.idToken || body.accessToken || '',
    );
  }

  /** Alias: POST /auth/verify with {token} — mobile's magic-link verification */
  @Post('verify')
  verifyMagicLinkPost(@Body() body: { token: string }) {
    return this.authService.verifyMagicLink(body.token);
  }
}
