import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(cfg: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.get('JWT_ACCESS_SECRET') || cfg.get('JWT_SECRET') || (() => {
        if (process.env.NODE_ENV === 'production') throw new Error('JWT_ACCESS_SECRET must be set in production');
        return 'dev-secret-not-for-production';
      })(),
    });
  }

  async validate(payload: any) {
    return { id: payload.sub, email: payload.email };
  }
}
