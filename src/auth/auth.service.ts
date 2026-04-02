import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { User, AuthProvider } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  RegisterDto,
  LoginDto,
  MagicLinkDto,
  AppleAuthDto,
  OtpSendDto,
  OtpVerifyDto,
} from './dto/auth.dto';
import Redis from 'ioredis';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly redis: Redis;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly cfg: ConfigService,
    private readonly notifications: NotificationsService,
  ) {
    this.redis = new Redis(cfg.get<string>('REDIS_URL') || 'redis://localhost:6379');
  }

  private generateTokens(user: User) {
    const payload = { sub: user.id, email: user.email };

    // Support both JWT_ACCESS_SECRET (new) and JWT_SECRET (legacy) env var names
    const jwtSecret = this.cfg.get('JWT_ACCESS_SECRET') || this.cfg.get('JWT_SECRET');
    if (!jwtSecret && process.env.NODE_ENV === 'production') {
      throw new Error('JWT_ACCESS_SECRET must be set in production');
    }

    const jwtRefreshSecret = this.cfg.get('JWT_REFRESH_SECRET');
    if (!jwtRefreshSecret && process.env.NODE_ENV === 'production') {
      throw new Error('JWT_REFRESH_SECRET must be set in production');
    }

    const accessToken = this.jwtService.sign(payload, {
      secret: jwtSecret || 'secret',
      expiresIn: this.cfg.get('JWT_EXPIRES_IN', '7d'),
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: jwtRefreshSecret || 'refresh-secret',
      expiresIn: this.cfg.get('JWT_REFRESH_EXPIRES_IN', '30d'),
    });
    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already in use');

    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const user = await this.usersService.create({
      email: dto.email,
      password: hashedPassword,
      name: dto.name,
      provider: AuthProvider.LOCAL,
    });

    const tokens = this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return { user, ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    if (!user || !user.password)
      throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const tokens = this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return { user, ...tokens };
  }

  async googleLogin(googleUser: any) {
    let user = await this.usersService.findByEmail(googleUser.email);
    if (!user) {
      user = await this.usersService.create({
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.avatarUrl,
        provider: AuthProvider.GOOGLE,
        providerId: googleUser.providerId,
      });
    }
    const tokens = this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return { user, ...tokens };
  }

  async appleLogin(dto: AppleAuthDto) {
    // Verify Apple token - simplified implementation
    // In production use apple-signin-auth library
    const { idToken, name } = dto;
    let payload: any;
    try {
      payload = this.jwtService.decode(idToken) as any;
    } catch {
      throw new UnauthorizedException('Invalid Apple token');
    }

    const email = payload?.email;
    if (!email) throw new BadRequestException('Email not provided by Apple');

    let user = await this.usersService.findByEmail(email);
    if (!user) {
      user = await this.usersService.create({
        email,
        name: name || email.split('@')[0],
        provider: AuthProvider.APPLE,
        providerId: payload.sub,
      });
    }

    const tokens = this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return { user, ...tokens };
  }

  async sendMagicLink(dto: MagicLinkDto) {
    let user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      user = await this.usersService.create({
        email: dto.email,
        provider: AuthProvider.LOCAL,
      });
    }

    const magicLinkSecret = this.cfg.get('MAGIC_LINK_SECRET');
    if (!magicLinkSecret && process.env.NODE_ENV === 'production') {
      throw new Error('MAGIC_LINK_SECRET must be set in production');
    }

    const token = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'magic-link' },
      {
        secret: magicLinkSecret || 'magic-secret',
        expiresIn: '15m',
      },
    );

    const expiry = new Date(Date.now() + 15 * 60 * 1000);
    await this.usersService.update(user.id, {
      magicLinkToken: token,
      magicLinkExpiry: expiry,
    });

    const appUrl = this.cfg.get('APP_URL', 'https://app.subradar.ai');
    const link = `${appUrl}/auth/magic?token=${token}`;

    const isProd = this.cfg.get('NODE_ENV') === 'production';

    await this.notifications.sendEmail(
        dto.email,
        'Your SubRadar sign-in link',
        `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="margin-bottom:8px">Sign in to SubRadar</h2>
            <p style="color:#666;margin-bottom:24px">Click the button below to sign in. This link expires in 15 minutes.</p>
            <a href="${link}" style="display:inline-block;background:#8B5CF6;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:600">
              Sign in to SubRadar
            </a>
            <p style="color:#999;font-size:12px;margin-top:24px">If you didn't request this, ignore this email.</p>
          </div>
        `,
      );

    // В dev — возвращаем ссылку в ответе для удобства тестирования
    return {
      message: 'Magic link sent',
      ...(isProd ? {} : { link }),
    };
  }

  async verifyMagicLink(token: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: this.cfg.get('MAGIC_LINK_SECRET') || 'magic-secret',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    const user = await this.usersService.findById(payload.sub);
    if (user.magicLinkToken !== token)
      throw new UnauthorizedException('Token already used');
    if (!user.magicLinkExpiry || new Date() > new Date(user.magicLinkExpiry))
      throw new UnauthorizedException('Link expired');

    await this.usersService.update(user.id, {
      magicLinkToken: undefined,
      magicLinkExpiry: undefined,
    });

    const tokens = this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return { user, ...tokens };
  }

  async refresh(token: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: this.cfg.get('JWT_REFRESH_SECRET') || 'refresh-secret',
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user.refreshToken) throw new UnauthorizedException('Refresh token revoked');
    const valid = await bcrypt.compare(token, user.refreshToken);
    if (!valid) throw new UnauthorizedException('Refresh token revoked');

    const tokens = this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async googleTokenLogin(token: string) {
    if (!token) throw new UnauthorizedException('Token required');

    let email: string, name: string, avatarUrl: string, providerId: string;

    // Try as access_token first (from @react-oauth/google useGoogleLogin)
    try {
      const res = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const profile = await res.json();
        email = profile.email;
        name = profile.name || profile.email.split('@')[0];
        avatarUrl = profile.picture;
        providerId = profile.sub;
      } else {
        // Try as id_token
        const payload = this.jwtService.decode(token) as any;
        if (!payload?.email)
          throw new UnauthorizedException('Invalid Google token');
        email = payload.email;
        name = payload.name || payload.email.split('@')[0];
        avatarUrl = payload.picture;
        providerId = payload.sub;
      }
    } catch {
      throw new UnauthorizedException('Failed to verify Google token');
    }

    this.logger.log(`googleTokenLogin: email=${email}, providerId=${providerId}`);
    try {
      let user = await this.usersService.findByEmail(email);
      if (!user) {
        this.logger.log(`googleTokenLogin: creating new user ${email}`);
        user = await this.usersService.create({
          email,
          name,
          avatarUrl,
          provider: AuthProvider.GOOGLE,
          providerId,
        });
      }
      this.logger.log(`googleTokenLogin: generating tokens for user ${user.id}`);
      const tokens = this.generateTokens(user);
      await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
      this.logger.log(`googleTokenLogin: success for ${email}`);
      return { user, ...tokens };
    } catch (dbError: any) {
      this.logger.error(`googleTokenLogin DB error for ${email}: ${dbError?.message}`, dbError?.stack);
      throw new InternalServerErrorException('Authentication failed. Please try again.');
    }
  }

  async sendOtp(dto: OtpSendDto) {
    // Demo/reviewer account — fixed OTP, no email sent (non-production only)
    const DEMO_EMAILS = ['reviewer@subradar.ai', 'demo@subradar.ai'];
    const allowDemo = process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEMO_ACCOUNTS === 'true';
    if (allowDemo && DEMO_EMAILS.includes(dto.email.toLowerCase())) {
      await this.redis.set(`otp:${dto.email}`, '123456', 'EX', 86400); // 24h TTL
      return { message: 'OTP sent' };
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(`otp:${dto.email}`, code, 'EX', 900);

    await this.notifications.sendEmail(
      dto.email,
      'Your SubRadar verification code',
      `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <h2 style="margin-bottom:8px">Your verification code</h2>
          <p style="color:#666;margin-bottom:24px">Enter this code to sign in to SubRadar. It expires in 15 minutes.</p>
          <div style="background:#f4f0ff;border-radius:12px;padding:20px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#8B5CF6;">
            ${code}
          </div>
          <p style="color:#999;font-size:12px;margin-top:24px">If you didn't request this, ignore this email.</p>
        </div>
      `,
    );

    const isProd = this.cfg.get('NODE_ENV') === 'production';
    return {
      message: 'OTP sent',
      ...(isProd ? {} : { code }),
    };
  }

  async verifyOtp(dto: OtpVerifyDto) {
    const stored = await this.redis.get(`otp:${dto.email}`);
    if (!stored) throw new UnauthorizedException('OTP expired or not found');
    if (stored !== dto.code) throw new UnauthorizedException('Invalid OTP code');

    await this.redis.del(`otp:${dto.email}`);

    const DEMO_EMAILS = ['reviewer@subradar.ai', 'demo@subradar.ai'];
    const isDemo = DEMO_EMAILS.includes(dto.email.toLowerCase());

    let user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      user = await this.usersService.create({
        email: dto.email,
        provider: AuthProvider.LOCAL,
      });
    }

    // Ensure demo accounts always have Pro plan
    if (isDemo && user.plan !== 'pro' && user.plan !== 'organization') {
      await this.usersService.update(user.id, { plan: 'pro' } as any);
      user = { ...user, plan: 'pro' as any };
      // Re-set OTP for next login (never expires for demo)
      await this.redis.set(`otp:${dto.email}`, '123456', 'EX', 86400);
    }

    const tokens = this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return { user, ...tokens };
  }

  async logout(userId: string) {
    await this.usersService.updateRefreshToken(userId, null);
    return { message: 'Logged out' };
  }
}
