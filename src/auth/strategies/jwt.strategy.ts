import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly expectedIssuer: string;
  private readonly expectedAudience: string;

  constructor(
    cfg: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
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

    // V3.5.2: tokenVersion check. Legacy JWTs minted before this column
    // existed have no `tv` claim — accept them during the grace window
    // (until natural expiry, max 30d for refresh / 7d for access). New
    // JWTs MUST carry tv and it MUST match the User row, otherwise the
    // user has logged out (or had their password changed) and every
    // outstanding token is revoked at once.
    if (payload?.tv !== undefined && payload.tv !== null) {
      // Single light query per request — keep `id` + `tokenVersion` only.
      // No join, no relation eager-loads.
      const row = await this.userRepo.findOne({
        where: { id: payload.sub },
        select: ['id', 'tokenVersion'],
      });
      if (!row) {
        this.logger.warn(`JWT rejected: user ${payload.sub} not found`);
        throw new UnauthorizedException('Invalid token');
      }
      if (row.tokenVersion !== payload.tv) {
        this.logger.warn(
          `JWT rejected: tokenVersion mismatch (token=${payload.tv}, db=${row.tokenVersion})`,
        );
        throw new UnauthorizedException('Token revoked');
      }
    }

    return { id: payload.sub, email: payload.email };
  }
}
