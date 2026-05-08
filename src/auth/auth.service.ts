import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  buildMagicLinkEmail,
  buildOtpEmail,
} from '../notifications/email-templates';
import {
  RegisterDto,
  LoginDto,
  MagicLinkDto,
  AppleAuthDto,
  OtpSendDto,
  OtpVerifyDto,
} from './dto/auth.dto';
import Redis from 'ioredis';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../common/redis.module';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { maskEmail } from '../common/utils/pii';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly cfg: ConfigService,
    private readonly notifications: NotificationsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private generateTokens(user: User) {
    const payload = { sub: user.id, email: user.email };

    // Support both JWT_ACCESS_SECRET (new) and JWT_SECRET (legacy) env var names
    const jwtSecret =
      this.cfg.get('JWT_ACCESS_SECRET') || this.cfg.get('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_ACCESS_SECRET env var is required');
    }

    const jwtRefreshSecret = this.cfg.get('JWT_REFRESH_SECRET');
    if (!jwtRefreshSecret) {
      throw new Error('JWT_REFRESH_SECRET env var is required');
    }

    const accessToken = this.jwtService.sign(payload, {
      secret: jwtSecret,
      expiresIn: this.cfg.get('JWT_EXPIRES_IN', '7d'),
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: jwtRefreshSecret,
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

    this.logger.log(`Account created: ${maskEmail(dto.email)}`);
    const tokens = this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return { user, ...tokens };
  }

  async login(dto: LoginDto) {
    // Check lockout
    const lockKey = `auth:lockout:${dto.email}`;
    const failCount = parseInt((await this.redis.get(lockKey)) || '0');
    if (failCount >= 10) {
      throw new ForbiddenException(
        'Account temporarily locked. Try again in 1 hour.',
      );
    }

    const user = await this.usersService.findByEmailWithPassword(dto.email);
    if (!user || !user.password) {
      this.logger.warn(
        `Login failed (user not found): ${maskEmail(dto.email)}`,
      );
      await this.redis.incr(lockKey);
      await this.redis.expire(lockKey, 3600);
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      this.logger.warn(
        `Login failed (wrong password): ${maskEmail(dto.email)}`,
      );
      await this.redis.incr(lockKey);
      await this.redis.expire(lockKey, 3600);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Clear lockout on success
    await this.redis.del(lockKey);

    this.logger.log(`Login success: ${maskEmail(dto.email)}`);
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
    const { idToken, name } = dto;
    // Fail closed: refuse to verify Apple tokens without an explicit
    // audience binding. A hardcoded fallback would let any Apple-issued
    // token for an unrelated bundle log into SubRadar.
    const appleAudience = process.env.APPLE_CLIENT_ID;
    if (!appleAudience) {
      this.logger.error(
        'APPLE_CLIENT_ID env var is not set — refusing Apple login',
      );
      throw new InternalServerErrorException('Apple Sign-In not configured');
    }
    let payload: any;
    try {
      // Verify Apple token signature cryptographically using Apple's public keys
      const appleSignin = require('apple-signin-auth');
      payload = await appleSignin.verifyIdToken(idToken, {
        audience: appleAudience,
        ignoreExpiration: false,
      });
    } catch (e: any) {
      this.logger.warn(`Apple token verification failed: ${e?.message}`);
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

    // Generate opaque random token (sent to user via email) and store only its
    // sha256 hash in the DB. Prevents DB-read attackers from using leaked tokens.
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const expiry = new Date(Date.now() + 15 * 60 * 1000);
    await this.usersService.update(user.id, {
      magicLinkToken: tokenHash,
      magicLinkExpiry: expiry,
    });

    const appUrl = this.cfg.get('APP_URL', 'https://app.subradar.ai');
    const link = `${appUrl}/auth/magic?token=${token}`;

    const isProd = this.cfg.get('NODE_ENV') === 'production';

    const magicEmail = buildMagicLinkEmail({
      locale: dto.locale ?? user.locale ?? 'en',
      link,
    });
    await this.notifications.sendEmail(
      dto.email,
      magicEmail.subject,
      magicEmail.html,
    );

    // В dev — возвращаем ссылку в ответе для удобства тестирования
    return {
      message: 'Magic link sent',
      ...(isProd ? {} : { link }),
    };
  }

  async verifyMagicLink(token: string) {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    // New format: opaque hex token; DB stores sha256(token).
    const tokenHash = createHash('sha256').update(token).digest('hex');
    let user = await this.usersService.findByMagicLinkToken(tokenHash);

    // Legacy fallback: older links shipped a JWT stored verbatim in the column.
    // Verify signature + expiry via JWT, then lookup the user by the raw token.
    if (!user) {
      const magicSecret = this.cfg.get('MAGIC_LINK_SECRET');
      if (magicSecret) {
        try {
          const payload: any = this.jwtService.verify(token, {
            secret: magicSecret,
          });
          if (payload?.sub) {
            const byId = await this.usersService
              .findById(payload.sub)
              .catch(() => null);
            if (byId && byId.magicLinkToken === token) {
              user = byId;
            }
          }
        } catch {
          // fall through
        }
      }
    }

    if (!user) throw new UnauthorizedException('Invalid or expired magic link');
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

  private parseDurationMs(
    value: string | undefined,
    fallbackMs: number,
  ): number {
    if (!value) return fallbackMs;
    const m = /^(\d+)\s*([smhd])$/.exec(value.trim());
    if (!m) {
      const asInt = parseInt(value, 10);
      return Number.isFinite(asInt) && asInt > 0 ? asInt * 1000 : fallbackMs;
    }
    const n = parseInt(m[1], 10);
    const unit = m[2];
    const mult =
      unit === 's'
        ? 1000
        : unit === 'm'
          ? 60_000
          : unit === 'h'
            ? 3_600_000
            : 86_400_000;
    return n * mult;
  }

  async refresh(token: string) {
    let payload: any;
    try {
      const refreshSecret = this.cfg.get('JWT_REFRESH_SECRET');
      if (!refreshSecret)
        throw new Error('JWT_REFRESH_SECRET env var is required');
      payload = this.jwtService.verify(token, {
        secret: refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user.refreshToken)
      throw new UnauthorizedException('Refresh token revoked');
    const valid = await bcrypt.compare(token, user.refreshToken);
    if (!valid) throw new UnauthorizedException('Refresh token revoked');

    // Absolute expiry guard — reject tokens older than JWT_REFRESH_EXPIRES_IN
    // even if the JWT `exp` claim says otherwise. Belt-and-suspenders in case
    // the signing secret leaks or a forged JWT slips through.
    const expiresIn = this.cfg.get<string>('JWT_REFRESH_EXPIRES_IN', '30d');
    const maxAgeMs = this.parseDurationMs(expiresIn, 30 * 24 * 3600 * 1000);
    if (user.refreshTokenIssuedAt) {
      const ageMs = Date.now() - new Date(user.refreshTokenIssuedAt).getTime();
      if (ageMs > maxAgeMs) {
        await this.usersService.updateRefreshToken(user.id, null);
        throw new UnauthorizedException('Refresh token expired');
      }
    }

    const tokens = this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  /**
   * Returns the list of accepted Google OAuth audiences (client IDs).
   * Supports distinct IDs per platform so iOS/Android tokens can be validated
   * without cross-accepting tokens minted for a different client.
   */
  private getGoogleAudiences(): string[] {
    const audiences = [
      this.cfg.get<string>('GOOGLE_CLIENT_ID_IOS'),
      this.cfg.get<string>('GOOGLE_CLIENT_ID_ANDROID'),
      this.cfg.get<string>('GOOGLE_CLIENT_ID_WEB'),
      this.cfg.get<string>('GOOGLE_CLIENT_ID'),
    ]
      .filter((x): x is string => !!x && x.length > 0)
      .map((x) => x.trim());
    // Deduplicate
    return Array.from(new Set(audiences));
  }

  /**
   * Verify a Google ID token (JWT) signature and audience using Google's public keys.
   * Fails closed on any mismatch between `aud`/`azp` and the list of accepted client IDs.
   */
  private async verifyGoogleIdToken(idToken: string): Promise<{
    email: string;
    name?: string;
    picture?: string;
    sub: string;
  } | null> {
    const audiences = this.getGoogleAudiences();
    if (audiences.length === 0) {
      this.logger.warn('verifyGoogleIdToken: no GOOGLE_CLIENT_ID_* configured');
      return null;
    }
    try {
      // Dynamic require to avoid hard dependency at module-load time — the lib
      // ships transitively via firebase-admin.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { OAuth2Client } = require('google-auth-library');
      const client = new OAuth2Client();
      const ticket = await client.verifyIdToken({
        idToken,
        audience: audiences,
      });
      const payload = ticket.getPayload();
      if (!payload?.email) return null;
      // Extra defense: verifyIdToken already validates `aud`, but re-check `azp`
      // (authorized party) explicitly — some libs treat it as advisory only.
      if (payload.azp && !audiences.includes(payload.azp)) {
        this.logger.warn(`verifyGoogleIdToken: azp mismatch (${payload.azp})`);
        return null;
      }
      return {
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        sub: payload.sub!,
      };
    } catch (e: any) {
      this.logger.warn(
        `verifyGoogleIdToken: signature/audience check failed: ${e?.message}`,
      );
      return null;
    }
  }

  async googleTokenLogin(token: string) {
    if (!token) throw new UnauthorizedException('Token required');

    let email: string | undefined;
    let name: string | undefined;
    let avatarUrl: string | undefined;
    let providerId: string | undefined;

    // Path 1: treat as Google ID token (JWT with 3 dot-separated segments).
    // Native mobile flows (iOS/Android) send idToken — this is the preferred
    // path because it cryptographically binds the token to our client IDs.
    const looksLikeJwt = token.split('.').length === 3;
    if (looksLikeJwt) {
      const verified = await this.verifyGoogleIdToken(token);
      if (verified) {
        email = verified.email;
        name = verified.name || verified.email.split('@')[0];
        avatarUrl = verified.picture;
        providerId = verified.sub;
      }
    }

    // Path 2: access_token flow (web via @react-oauth/google useGoogleLogin).
    // We must validate audience server-side via tokeninfo BEFORE trusting the
    // userinfo response — without this an attacker can replay any Google
    // access_token issued for any other app and log in as that user here.
    if (!email) {
      const audiences = this.getGoogleAudiences();
      if (audiences.length === 0) {
        this.logger.warn(
          'googleTokenLogin Path 2: no GOOGLE_CLIENT_ID_* configured',
        );
        throw new UnauthorizedException(
          'Google access-token login not configured',
        );
      }
      // Node 20 `fetch` has NO default timeout — without an explicit signal a
      // hanging Google endpoint blocks the request handler indefinitely and
      // an attacker with a slow upstream can starve the pool.
      const fetchTimeoutMs = 5000;
      try {
        const tokenInfoRes = await fetch(
          `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`,
          { signal: AbortSignal.timeout(fetchTimeoutMs) },
        );
        if (!tokenInfoRes.ok) {
          throw new UnauthorizedException('Invalid Google access token');
        }
        const tokenInfo = (await tokenInfoRes.json()) as any;
        // For access tokens `aud` is the canonical client_id binding.
        // `azp` (authorized party) is set on ID tokens and may be present
        // on access tokens via OIDC; require BOTH to be in the allowlist
        // when both are present so a token with `aud` matching ours but
        // `azp` foreign (or vice-versa) is rejected.
        const tokenAud = tokenInfo?.aud;
        const tokenAzp = tokenInfo?.azp;
        const audOk = tokenAud
          ? audiences.includes(tokenAud)
          : tokenAzp
            ? audiences.includes(tokenAzp)
            : false;
        const azpOk = tokenAzp ? audiences.includes(tokenAzp) : true;
        if (!audOk || !azpOk) {
          this.logger.warn(
            `googleTokenLogin Path 2: audience mismatch (aud=${tokenAud}, azp=${tokenAzp})`,
          );
          throw new UnauthorizedException('Google token audience mismatch');
        }
        const res = await fetch(
          `https://www.googleapis.com/oauth2/v3/userinfo`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(fetchTimeoutMs),
          },
        );
        if (!res.ok) {
          throw new UnauthorizedException(
            'Invalid Google token — userinfo request failed',
          );
        }
        const profile = (await res.json()) as any;
        if (!profile?.email) {
          throw new UnauthorizedException('Google token missing email');
        }
        email = profile.email;
        name = profile.name || profile.email.split('@')[0];
        avatarUrl = profile.picture;
        providerId = profile.sub;
      } catch (e) {
        if (e instanceof UnauthorizedException) throw e;
        // AbortError/network/JSON parse failures all collapse here — log
        // the class so a Google outage isn't invisible.
        this.logger.warn(
          `googleTokenLogin Path 2: ${(e as any)?.name ?? 'error'}: ${(e as any)?.message ?? 'unknown'}`,
        );
        throw new UnauthorizedException('Failed to verify Google token');
      }
    }

    if (!email || !providerId) {
      throw new UnauthorizedException('Failed to verify Google token');
    }

    this.logger.log(`googleTokenLogin: email=${maskEmail(email)}`);
    try {
      let user = await this.usersService.findByEmail(email);
      if (!user) {
        this.logger.log(
          `googleTokenLogin: creating new user ${maskEmail(email)}`,
        );
        user = await this.usersService.create({
          email,
          name,
          avatarUrl,
          provider: AuthProvider.GOOGLE,
          providerId,
        });
      }
      const tokens = this.generateTokens(user);
      await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
      this.logger.log(`googleTokenLogin: success for ${maskEmail(email)}`);
      return { user, ...tokens };
    } catch (dbError: any) {
      this.logger.error(
        `googleTokenLogin DB error for ${maskEmail(email)}: ${dbError?.message}`,
        dbError?.stack,
      );
      throw new InternalServerErrorException(
        'Authentication failed. Please try again.',
      );
    }
  }

  async sendOtp(dto: OtpSendDto) {
    // Fixed OTP for App Store review account. This is a live backdoor into any
    // email matching review@subradar.ai, so it must be explicitly enabled per
    // environment — in production we only flip ENABLE_REVIEW_ACCOUNT=true while
    // Apple is actively reviewing the build.
    const isReviewAccount = dto.email === 'review@subradar.ai';
    // Maestro E2E seed users share the same `000000` bypass but only on
    // non-prod environments — the `qa-*@subradar.test` domain never exists
    // in reality, so this is a safe channel for the test harness.
    const isE2ESeed =
      !!dto.email &&
      dto.email.startsWith('qa-') &&
      dto.email.endsWith('@subradar.test') &&
      process.env.NODE_ENV !== 'production';
    const isBypass = isReviewAccount || isE2ESeed;
    if (isReviewAccount && process.env.ENABLE_REVIEW_ACCOUNT !== 'true') {
      this.logger.warn(
        `Review account OTP attempted while disabled: ${maskEmail(dto.email)}`,
      );
      throw new ForbiddenException('Review account is disabled');
    }
    if (isE2ESeed && process.env.ENABLE_REVIEW_ACCOUNT !== 'true') {
      this.logger.warn(
        `E2E seed OTP attempted while disabled: ${maskEmail(dto.email)}`,
      );
      throw new ForbiddenException('E2E seed accounts disabled');
    }
    const code = isBypass ? '000000' : randomInt(100000, 1000000).toString();
    // Store sha256 of the code, never the plaintext. A Redis dump must not
    // disclose any live login codes.
    const codeHash = createHash('sha256').update(code).digest('hex');
    await this.redis.set(`otp:${dto.email}`, codeHash, 'EX', 900);

    const otpEmail = buildOtpEmail({
      locale: dto.locale ?? 'en',
      code,
    });
    await this.notifications.sendEmail(
      dto.email,
      otpEmail.subject,
      otpEmail.html,
    );

    const isProd = this.cfg.get('NODE_ENV') === 'production';
    return {
      message: 'OTP sent',
      ...(isProd ? {} : { code }),
    };
  }

  async verifyOtp(dto: OtpVerifyDto) {
    // Check OTP lockout
    const otpLockKey = `auth:lockout:otp:${dto.email}`;
    const otpFailCount = parseInt((await this.redis.get(otpLockKey)) || '0');
    if (otpFailCount >= 10) {
      throw new ForbiddenException(
        'Too many failed OTP attempts. Try again in 1 hour.',
      );
    }

    const storedHash = await this.redis.get(`otp:${dto.email}`);
    if (!storedHash) {
      this.logger.warn(
        `OTP verification failed (expired/not found): ${maskEmail(dto.email)}`,
      );
      await this.redis.incr(otpLockKey);
      await this.redis.expire(otpLockKey, 3600);
      throw new UnauthorizedException('OTP expired or not found');
    }
    const submittedHash = createHash('sha256').update(dto.code).digest('hex');
    // Constant-time compare: short-circuiting `!==` on the hex string would
    // leak prefix-match length via timing. With a per-email lockout this is
    // hard to exploit, but auditors flag non-timing-safe compares on sight,
    // and an attacker iterating across many emails amortises the budget.
    const storedBuf = Buffer.from(storedHash, 'hex');
    const submittedBuf = Buffer.from(submittedHash, 'hex');
    const otpMatches =
      storedBuf.length === submittedBuf.length &&
      timingSafeEqual(storedBuf, submittedBuf);
    if (!otpMatches) {
      this.logger.warn(
        `OTP verification failed (wrong code): ${maskEmail(dto.email)}`,
      );
      await this.redis.incr(otpLockKey);
      await this.redis.expire(otpLockKey, 3600);
      throw new UnauthorizedException('Invalid OTP code');
    }

    await this.redis.del(`otp:${dto.email}`);
    // Clear OTP lockout on success
    await this.redis.del(otpLockKey);

    let user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      user = await this.usersService.create({
        email: dto.email,
        provider: AuthProvider.LOCAL,
      });
      this.logger.log(`Account created via OTP: ${maskEmail(dto.email)}`);
    }

    this.logger.log(`Login success via OTP: ${maskEmail(dto.email)}`);
    const tokens = this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    return { user, ...tokens };
  }

  async logout(userId: string) {
    await this.usersService.updateRefreshToken(userId, null);
    return { message: 'Logged out' };
  }
}
