# SubRadar Security Architecture

Owner: Security
Reviewed: 2026-05-08
Audience: CASA Tier 2 reviewer + internal devs

This document satisfies ASVS V1.1.2 (authn architecture), V1.1.3 (session
management), V1.1.4 (access control), V1.1.6 (cryptography), V1.1.7
(audit logging) — collected here so a reviewer has one canonical place
to verify each property without grepping the codebase.

## Authentication

Five inbound authentication flows. All converge to the same JWT token
pair after a successful login.

| Flow | Where | Credential | Anti-automation |
|---|---|---|---|
| Email + password | `POST /auth/register`, `POST /auth/login` | bcrypt cost 12 | 5/15min/email + 10-attempt 1h lockout |
| Google OAuth (web) | `GET /auth/google` → `/google/callback` | OIDC `id_token`, `aud` pinned | Google rate-limits |
| Google ID-token (mobile) | `POST /auth/google/token` | OIDC `id_token`; access-token Path 2 verifies `aud`+`azp` via tokeninfo | 5/15min/email |
| Apple Sign-In | `POST /auth/apple` | OIDC `id_token` verified against Apple JWKs; `aud` from `APPLE_CLIENT_ID` (fail-closed if unset) | 5/15min/email |
| Magic link | `POST /auth/magic-link` → `GET /auth/magic` | 256-bit opaque token; sha256 stored; 15-min TTL; single-use (deleted on consumption) | 5/15min/email |
| OTP | `POST /auth/otp/send` → `POST /auth/otp/verify` | 6-digit `crypto.randomInt`; sha256 in Redis; 15-min TTL; lockout 10 attempts | 5/15min/email |

**Password policy** (V2.1.1 + V2.1.9): minimum 12 characters, no
composition rules. Existing users with shorter pre-policy passwords keep
working until they next reset; CASA accepts this rolling migration.

## Session Management

Stateless JWT, two tokens, both HS256 with 256-bit secrets.

| Token | TTL | Stored | Rotation | Revocation |
|---|---|---|---|---|
| Access | `JWT_EXPIRES_IN` (default 7d, target 15m) | client only (Bearer header) | none | `tokenVersion` bump (logout / password change) |
| Refresh | `JWT_REFRESH_EXPIRES_IN` (30d) | bcrypt-hashed in `users.refreshToken` + `refreshTokenIssuedAt` | rotated on every `/auth/refresh` | NULL'd on logout, absolute-expiry guard against replay |

**Claims** (V3.7.1): every minted JWT carries `sub`, `email`, `iss`,
`aud`, `tv`. JwtStrategy verifies `iss`/`aud`/`tv` only when present
(grace mode for legacy tokens minted before this commit set landed —
they keep working until natural expiry).

**HS256 pinned**: `algorithms: ['HS256']` in JwtStrategy prevents
algorithm-confusion attacks (`alg: none`, RS256 swap).

**Logout** (V3.5.2): `bumpTokenVersion(userId)` increments `users.tokenVersion`
atomically, then NULL's `users.refreshToken`. Bumping FIRST means the
access JWT in the user's hand is invalidated at the same instant the
refresh is revoked — no race window.

**Anti-fixation**: a fresh access+refresh pair is minted on every
authentication event; nothing is reused across login attempts.

## Access Control

| Layer | What it does |
|---|---|
| `JwtAuthGuard` (per controller class or method) | Validates Bearer JWT; attaches `req.user` |
| `EmailThrottlerGuard` | Per-email rate limit on auth-adjacent routes |
| `RolesGuard` | Workspace/team admin checks via `@Roles()` decorator |
| `SubscriptionLimitGuard` | Free-plan subscription cap (also enforced in service) |
| Service-level userId filtering | Every resource read/write goes through `req.user.id` filter — no IDOR via raw `:id` lookups |
| Webhook routes | Public; HMAC-bound on raw body |
| `Origin` middleware | Rejects origin-less state-changing requests unless they carry a non-browser UA / explicit `X-Client` hint |

**Admin endpoints** (the few that exist) are gated behind `ADMIN_EMAILS`
env list and emit `audit_logs` rows. No public RBAC system; plan upgrades
keyed off `users.plan` (`free`/`pro`/`team`/`organization`).

## Cryptography

| Use | Algorithm | Key source |
|---|---|---|
| Password hashing | bcrypt cost 12 | per-row salt |
| Refresh-token at-rest | bcrypt cost 12 | per-row salt |
| Magic-link at-rest | sha256 (one-way) | n/a |
| OTP at-rest (Redis) | sha256 (one-way) | n/a |
| OTP comparison | `crypto.timingSafeEqual` | sha256 hex buffers |
| Webhook signing (Lemon Squeezy) | HMAC-SHA256 | `LEMON_SQUEEZY_WEBHOOK_SECRET` |
| Webhook auth (RevenueCat) | shared-secret + `timingSafeEqual` | `REVENUECAT_WEBHOOK_SECRET` |
| Webhook signing (Resend) | Svix HMAC | `RESEND_WEBHOOK_SECRET` |
| Magic-link tokens / refresh tokens (random) | `crypto.randomBytes(32)` | CSPRNG |
| OTP / invite codes (random) | `crypto.randomInt` | CSPRNG |
| JWT signing | HS256 | `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (≥256-bit each, fail-closed if missing or whitespace-only) |
| TLS to clients | TLS 1.2+ at DO LB | DO-managed cert |
| TLS to managed PG | TLS 1.2+ | DO managed-PG CA pinnable via `DB_CA_CERT`/`DB_CA_PATH` |
| TLS to S3 / vendor APIs | HTTPS only | Node default trust store |
| **PII at rest (column-level)** | **AES-256-GCM**, versioned ciphertext `enc:v1:` | `DATA_ENCRYPTION_KEY` SHA-256-derived |
| S3 object storage | SSE-S3 (`AES256`) | DO Spaces / S3-managed |

**Key rotation**:

- JWT secrets: regenerate, deploy, accept old grace window TBD.
- `DATA_ENCRYPTION_KEY`: requires a one-shot script that decrypts under
  the old key and re-encrypts under the new (similar to
  `scripts/encrypt-legacy-pii.ts` but two-phase). Tracked separately.
- Webhook secrets: Lemon Squeezy has `LEMON_SQUEEZY_WEBHOOK_SECRET_V2`
  rotation hooks; rotation playbook in `docs/RUNBOOK.md`.

## Audit Logging

`audit_logs` table is append-only and persists:

`{ id, userId, action, resourceType, resourceId, metadata, ipAddress, userAgent, createdAt }`

Coverage:

| Action prefix | Emitted from | Coverage notes |
|---|---|---|
| `auth.register.{success,failure}` | AuthService.register | + reason, provider, isNew |
| `auth.login.{success,failure}` | login / googleLogin / googleTokenLogin / appleLogin / verifyOtp / verifyMagicLink | + provider, reason, isNew, IP/UA |
| `auth.refresh.{success,failure}` | AuthService.refresh | + reason on failure (invalid/revoked/mismatch/expired) |
| `auth.logout` | AuthService.logout | bumps tokenVersion + audit row |
| `auth.magic_link.{sent,failure}` | sendMagicLink / verifyMagicLink | reason: `invalid_token_shape` / `token_not_found` / `token_expired` |
| `auth.otp.{sent,failure}` | sendOtp / verifyOtp | reason: `lockout` / `expired_or_not_found` / `wrong_code` |
| `account.delete` | UsersService.deleteAccount | + email snapshot (masked) |
| `user.data_export` | UsersService.exportUserData (GDPR Art 20) | + counts |
| `billing.*` | BillingService | full set covered separately |

Email values are always masked via `maskEmail()` before going into
metadata. Full PII never appears in audit rows.

## Logging & Off-Host Shipping

`JsonLogger` is enabled when `NODE_ENV=production` or `LOG_FORMAT=json`.
Emits one JSON line per log call on stdout/stderr; DigitalOcean App
Platform / Logs ingests stdout automatically and indexes
`{ ts, level, context, msg, trace }` fields.

`AllExceptionsFilter` runs `redactSecrets()` over `request.url`, error
messages, and stack traces before they hit any log sink — covers
`?token=`, `?code=`, `?id_token=`, `?refresh_token=`, `?sig=`,
`?session=`, `?cookie=`, `Authorization: Bearer/Basic` headers, and any
JWT-shaped string. CRLF stripped to defend against log injection.

## Data Storage Inventory

For per-table retention and encryption posture see
[`docs/DATA_RETENTION.md`](DATA_RETENTION.md).
