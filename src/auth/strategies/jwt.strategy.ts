import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly expectedIssuer: string;
  private readonly expectedAudience: string;

  constructor(cfg: ConfigService) {
    const expectedIssuer = cfg.get<string>('JWT_ISSUER', 'subradar-api');
    const expectedAudience = cfg.get<string>('JWT_AUDIENCE', 'subradar-clients');
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
      // Grace mode: do NOT pass `issuer`/`audience` to passport-jwt's
      // built-in claim verification. Existing JWTs in mobile AsyncStorage and
      // web cookies were minted before iss/aud were added; failing them
      // upfront would log every active user out. We re-check the claims
      // manually in `validate` and only reject when present-but-wrong.
      // After the longest live token (refresh, 30d) expires, this can be
      // tightened to required-iss/aud by passing the values here directly.
    });
    this.expectedIssuer = expectedIssuer;
    this.expectedAudience = expectedAudience;
  }

  async validate(payload: any) {
    // V3.7.1: when iss/aud ARE present in the token, they MUST match —
    // a forged JWT with wrong iss/aud should not authenticate. Tokens
    // without claims (legacy) still pass during the grace window.
    if (payload?.iss && payload.iss !== this.expectedIssuer) {
      this.logger.warn(
        `JWT rejected: iss mismatch (got ${payload.iss}, want ${this.expectedIssuer})`,
      );
      throw new UnauthorizedException('Invalid token issuer');
    }
    if (payload?.aud && payload.aud !== this.expectedAudience) {
      this.logger.warn(
        `JWT rejected: aud mismatch (got ${JSON.stringify(payload.aud)}, want ${this.expectedAudience})`,
      );
      throw new UnauthorizedException('Invalid token audience');
    }
    return { id: payload.sub, email: payload.email };
  }
}
