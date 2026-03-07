import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly redis: Redis;

  constructor(cfg: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.get('JWT_SECRET', 'secret'),
    });
    this.redis = new Redis(cfg.get<string>('REDIS_URL') || 'redis://localhost:6379');
  }

  async validate(payload: any) {
    const storedSessionId = await this.redis.get(`session:${payload.sub}`);
    if (!storedSessionId || storedSessionId !== payload.sessionId) {
      throw new UnauthorizedException('Session expired');
    }
    return { id: payload.sub, email: payload.email, sessionId: payload.sessionId };
  }
}
