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
      // Pin algorithm to HS256 — prevents algorithm-confusion attacks where an
      // attacker swaps the header alg to "none" or an asymmetric algorithm.
      algorithms: ['HS256'],
      secretOrKey: (() => {
        const secret = cfg.get('JWT_ACCESS_SECRET') || cfg.get('JWT_SECRET');
        if (!secret) throw new Error('JWT_ACCESS_SECRET env var is required');
        return secret;
      })(),
    });
  }

  async validate(payload: any) {
    return { id: payload.sub, email: payload.email };
  }
}
