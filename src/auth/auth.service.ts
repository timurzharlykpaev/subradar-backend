import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { User, AuthProvider } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  RegisterDto,
  LoginDto,
  MagicLinkDto,
  AppleAuthDto,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
  private readonly redis: Redis;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly cfg: ConfigService,
    private readonly notifications: NotificationsService,
  ) {
    this.redis = new Redis(cfg.get<string>('REDIS_URL') || 'redis://localhost:6379');
  }

  async createSession(userId: string): Promise<string> {
    const sessionId = randomUUID();
    await this.redis.set(`session:${userId}`, sessionId, 'EX', 2592000);
    return sessionId;
  }

  private async generateTokens(user: User) {
    const sessionId = await this.createSession(user.id);
    const payload = { sub: user.id, email: user.email, sessionId };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.cfg.get('JWT_SECRET', 'secret'),
      expiresIn: this.cfg.get('JWT_EXPIRES_IN', '7d'),
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.cfg.get('JWT_REFRESH_SECRET', 'refresh-secret'),
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

    const tokens = await this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return { user, ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    if (!user || !user.password)
      throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.generateTokens(user);
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
    const tokens = await this.generateTokens(user);
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

    const tokens = await this.generateTokens(user);
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

    const token = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'magic-link' },
      {
        secret: this.cfg.get('MAGIC_LINK_SECRET', 'magic-secret'),
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
        secret: this.cfg.get('MAGIC_LINK_SECRET', 'magic-secret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    const user = await this.usersService.findById(payload.sub);
    if (user.magicLinkToken !== token)
      throw new UnauthorizedException('Token already used');
    if (new Date() > user.magicLinkExpiry)
      throw new UnauthorizedException('Magic link expired');

    await this.usersService.update(user.id, {
      magicLinkToken: undefined,
      magicLinkExpiry: undefined,
    });

    const tokens = await this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return { user, ...tokens };
  }

  async refresh(token: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: this.cfg.get('JWT_REFRESH_SECRET', 'refresh-secret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findById(payload.sub);
    if (user.refreshToken !== token)
      throw new UnauthorizedException('Refresh token revoked');

    const tokens = await this.generateTokens(user);
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

    let user = await this.usersService.findByEmail(email);
    if (!user) {
      user = await this.usersService.create({
        email,
        name,
        avatarUrl,
        provider: AuthProvider.GOOGLE,
        providerId,
      });
    }
    const tokens = await this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return { user, ...tokens };
  }

  async logout(userId: string) {
    await this.redis.del(`session:${userId}`);
    await this.usersService.updateRefreshToken(userId, null);
    return { message: 'Logged out' };
  }
}
