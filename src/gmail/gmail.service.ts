import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../common/audit/audit.service';
import { REDIS_CLIENT } from '../common/redis.module';
import { maskEmail } from '../common/utils/pii';

/**
 * Gmail OAuth integration. Separate from the sign-in flow in
 * `AuthService`: that one runs against `email`/`profile` (non-sensitive)
 * scopes and returns a session JWT. THIS one runs against
 * `gmail.readonly` (a Google "restricted" scope) and persists a
 * long-lived refresh token so we can poll Gmail for subscription
 * receipts on a schedule.
 *
 * Limited Use Compliance (Google API Services User Data Policy):
 *   1. Gmail data is used ONLY to identify subscription receipts and
 *      surface them in the user's SubRadar dashboard.
 *   2. Gmail data is NOT used for advertising.
 *   3. Gmail data is NOT transferred to third parties except where
 *      necessary to provide the feature (OpenAI for parsing — see
 *      docs/AI_BEHAVIOR.md and the Privacy Policy text shipped with
 *      this batch).
 *   4. Humans do not read Gmail data except for: (a) explicit user
 *      consent (e.g. support ticket reproduction), (b) security/abuse
 *      prevention, (c) legal compliance, (d) anonymised aggregates.
 *   5. Use is limited to what's described in the Privacy Policy.
 *
 * CASA Tier 2 / ASVS V8.3.7 + V6.4.1:
 *   - gmailRefreshToken is encrypted at rest via the AesGcmTransformer
 *     applied on User.gmailRefreshToken.
 *   - DATA_ENCRYPTION_KEY is held separately from the database and
 *     supplied via env (GitHub Actions secret).
 */
@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);
  private readonly REQUIRED_SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ];

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly cfg: ConfigService,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private requireConfig(): {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    stateSecret: string;
  } {
    const clientId = this.cfg.get<string>('GOOGLE_GMAIL_CLIENT_ID') ||
      this.cfg.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.cfg.get<string>('GOOGLE_GMAIL_CLIENT_SECRET') ||
      this.cfg.get<string>('GOOGLE_CLIENT_SECRET');
    const redirectUri = this.cfg.get<string>('GMAIL_REDIRECT_URI');
    // Reuse JWT_REFRESH_SECRET for state HMAC if no dedicated secret is
    // provisioned — both are server-only signing keys never exposed to
    // clients, so reusing one is acceptable until rotation happens.
    const stateSecret =
      this.cfg.get<string>('GMAIL_STATE_SECRET') ||
      this.cfg.get<string>('JWT_REFRESH_SECRET') ||
      '';
    if (!clientId || !clientSecret || !redirectUri || !stateSecret) {
      this.logger.error(
        'Gmail integration not configured (need GOOGLE_GMAIL_CLIENT_ID, GOOGLE_GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI, GMAIL_STATE_SECRET or JWT_REFRESH_SECRET)',
      );
      throw new InternalServerErrorException(
        'Gmail integration not configured',
      );
    }
    return { clientId, clientSecret, redirectUri, stateSecret };
  }

  /**
   * State token: `${userId}.${nonce}.${expEpoch}.${hmac}`. HMAC-bound to
   * the user starting the flow so an attacker can't substitute their
   * own state to fixate someone else's account. Single-use via Redis
   * SETNX with a 10-minute TTL.
   */
  private signState(userId: string, secret: string): string {
    const nonce = randomBytes(16).toString('base64url');
    const expEpoch = Math.floor(Date.now() / 1000) + 600; // 10 min
    const payload = `${userId}.${nonce}.${expEpoch}`;
    const hmac = createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${hmac}`;
  }

  private async verifyAndConsumeState(
    state: string,
    secret: string,
  ): Promise<{ userId: string; nonce: string }> {
    const parts = state.split('.');
    if (parts.length !== 4) {
      throw new UnauthorizedException('Invalid state format');
    }
    const [userId, nonce, expStr, hmacGiven] = parts;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Expired state');
    }
    const expectedHmac = createHmac('sha256', secret)
      .update(`${userId}.${nonce}.${expStr}`)
      .digest('base64url');
    const a = Buffer.from(hmacGiven);
    const b = Buffer.from(expectedHmac);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid state signature');
    }
    // Single-use enforcement: SETNX on the nonce. If the nonce has
    // already been consumed, the second call is a replay attempt.
    const setNx = await this.redis.set(
      `gmail-oauth-nonce:${nonce}`,
      '1',
      'EX',
      900,
      'NX',
    );
    if (setNx !== 'OK') {
      throw new UnauthorizedException('State already consumed (replay)');
    }
    return { userId, nonce };
  }

  /**
   * Build the URL the client should send the user to. We force
   * `prompt=consent` so Google ALWAYS issues a fresh refresh token
   * (without it, a user re-granting an already-granted scope set gets
   * an access token but no refresh — leaving us unable to poll). And we
   * force `access_type=offline` for the same reason.
   */
  buildAuthUrl(userId: string): string {
    const { clientId, redirectUri, stateSecret } = this.requireConfig();
    const state = this.signState(userId, stateSecret);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: this.REQUIRED_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async handleCallback(
    code: string,
    state: string,
    ctx?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ ok: true; gmailEmail: string }> {
    const { clientId, clientSecret, redirectUri, stateSecret } = this.requireConfig();
    const { userId } = await this.verifyAndConsumeState(state, stateSecret);

    // Exchange the authorization code for tokens.
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) {
      const errorText = await tokenRes.text().catch(() => '');
      this.logger.warn(
        `Gmail token exchange failed (${tokenRes.status}): ${errorText.slice(0, 200)}`,
      );
      await this.audit.log({
        userId,
        action: 'gmail.connect.failure',
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        metadata: { reason: 'token_exchange_failed', httpStatus: tokenRes.status },
      });
      throw new BadRequestException('Failed to exchange Google authorization code');
    }
    const tokens = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!tokens.refresh_token) {
      // Should never happen given prompt=consent + access_type=offline,
      // but defend explicitly.
      await this.audit.log({
        userId,
        action: 'gmail.connect.failure',
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        metadata: { reason: 'no_refresh_token' },
      });
      throw new BadRequestException(
        'Google did not return a refresh token. Try disconnecting and re-connecting.',
      );
    }
    // Verify the granted scopes include what we need. Google may grant
    // a subset if the user un-checks scopes on the consent screen.
    const grantedScopes = (tokens.scope || '').split(/\s+/).filter(Boolean);
    const missing = this.REQUIRED_SCOPES.filter(
      (s) => !grantedScopes.includes(s),
    );
    if (missing.length > 0) {
      await this.audit.log({
        userId,
        action: 'gmail.connect.failure',
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        metadata: { reason: 'incomplete_scopes', missing },
      });
      throw new BadRequestException(
        'Required Gmail permissions not granted. Please grant all requested scopes.',
      );
    }

    // Pull the email associated with this grant via userinfo. Stored as
    // gmailEmail so the in-app settings UI can show "Connected as X".
    const userinfoRes = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(5000),
      },
    );
    const userinfo = userinfoRes.ok
      ? ((await userinfoRes.json()) as { email?: string })
      : { email: undefined };
    const gmailEmail = userinfo?.email ?? '';

    // Persist. The transformer encrypts gmailRefreshToken on the way down.
    await this.userRepo.update(
      { id: userId },
      {
        gmailRefreshToken: tokens.refresh_token,
        gmailConnectedAt: new Date(),
        gmailEmail,
        gmailScopes: grantedScopes.join(','),
      },
    );

    this.logger.log(
      `Gmail connected for user ${userId} (${maskEmail(gmailEmail)})`,
    );
    await this.audit.log({
      userId,
      action: 'gmail.connect.success',
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: ctx?.userAgent ?? null,
      metadata: {
        emailMasked: maskEmail(gmailEmail),
        scopes: grantedScopes,
      },
    });
    return { ok: true, gmailEmail };
  }

  async getStatus(userId: string): Promise<{
    connected: boolean;
    email: string | null;
    connectedAt: Date | null;
    scopes: string[];
  }> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: [
        'id',
        'gmailRefreshToken',
        'gmailEmail',
        'gmailConnectedAt',
        'gmailScopes',
      ],
    });
    if (!user || !user.gmailRefreshToken) {
      return { connected: false, email: null, connectedAt: null, scopes: [] };
    }
    return {
      connected: true,
      email: user.gmailEmail ?? null,
      connectedAt: user.gmailConnectedAt,
      scopes: (user.gmailScopes ?? '').split(',').filter(Boolean),
    };
  }

  /**
   * Revoke the grant on Google's side AND null our stored tokens.
   * Best-effort on the revoke call (Google accepts already-revoked
   * tokens with a 4xx; we don't want to block a user's "disconnect"
   * action because Google had a bad day).
   */
  async disconnect(
    userId: string,
    ctx?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ revoked: boolean }> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'gmailRefreshToken', 'gmailEmail'],
    });
    if (!user || !user.gmailRefreshToken) {
      return { revoked: false };
    }
    const refreshToken = user.gmailRefreshToken;

    let revokeOk = false;
    try {
      const res = await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          signal: AbortSignal.timeout(5000),
        },
      );
      revokeOk = res.ok;
      if (!res.ok) {
        this.logger.warn(
          `Google revoke returned ${res.status} for user ${userId}; clearing local tokens anyway`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `Google revoke failed for user ${userId}: ${err?.message ?? err}; clearing local tokens anyway`,
      );
    }

    await this.userRepo.update(
      { id: userId },
      {
        gmailRefreshToken: null as any,
        gmailConnectedAt: null,
        gmailEmail: null as any,
        gmailScopes: null as any,
      },
    );
    await this.audit.log({
      userId,
      action: 'gmail.disconnect',
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: ctx?.userAgent ?? null,
      metadata: { revokedAtGoogle: revokeOk },
    });
    return { revoked: revokeOk };
  }
}
