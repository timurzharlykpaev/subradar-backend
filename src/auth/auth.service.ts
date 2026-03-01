import {
  Injectable, UnauthorizedException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { User, AuthProvider } from '../users/entities/user.entity';
import { RegisterDto, LoginDto, MagicLinkDto, AppleAuthDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly cfg: ConfigService,
  ) {}

  private generateTokens(user: User) {
    const payload = { sub: user.id, email: user.email };
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

    const tokens = this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return { user, ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    if (!user || !user.password) throw new UnauthorizedException('Invalid credentials');

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
      user = await this.usersService.create({ email: dto.email, provider: AuthProvider.LOCAL });
    }

    const token = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'magic-link' },
      { secret: this.cfg.get('MAGIC_LINK_SECRET', 'magic-secret'), expiresIn: '15m' },
    );

    const expiry = new Date(Date.now() + 15 * 60 * 1000);
    await this.usersService.update(user.id, { magicLinkToken: token, magicLinkExpiry: expiry });

    // TODO: send email via Resend
    const link = `${this.cfg.get('APP_URL')}/auth/magic?token=${token}`;
    return { message: 'Magic link sent', link }; // link exposed for dev
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
    if (user.magicLinkToken !== token) throw new UnauthorizedException('Token already used');
    if (new Date() > user.magicLinkExpiry) throw new UnauthorizedException('Magic link expired');

    await this.usersService.update(user.id, { magicLinkToken: undefined, magicLinkExpiry: undefined });

    const tokens = this.generateTokens(user);
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
    if (user.refreshToken !== token) throw new UnauthorizedException('Refresh token revoked');

    const tokens = this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async logout(userId: string) {
    await this.usersService.updateRefreshToken(userId, null);
    return { message: 'Logged out' };
  }
}
