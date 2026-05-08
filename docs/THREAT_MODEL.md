# SubRadar Threat Model

Owner: Security
Reviewed: 2026-05-08
Cadence: revisit at every major architectural change, minimum annually.

This document satisfies ASVS V1.1.1 and forms part of the CASA Tier 2
Self-Assessment evidence pack. STRIDE analysis is structured per trust
boundary so the controls listed below map cleanly onto specific code
locations and audit-log queries.

## System Context

```
                                                        ┌─────────────────┐
        ┌────────────┐                                  │ DigitalOcean PG │
        │  Mobile    │ ──┐                              │  (managed,      │
        │  iOS/iPad  │   │                              │   TLS, encrypted│
        │  Android   │   │       ┌────────────┐         │   at rest)      │
        └────────────┘   │       │  SubRadar  │ ◄──────►├─────────────────┤
                         ├─────► │  API       │         │  Postgres       │
        ┌────────────┐   │       │  (NestJS)  │ ◄─────► │  Redis (TLS)    │
        │   Web      │ ──┘       │  on DO     │         └─────────────────┘
        │ subradar.ai│           │  Droplet   │
        └────────────┘           └─────┬──────┘
                                       │
        Trust boundaries:              ├─► OpenAI (vendor TLS, no PII at rest)
        T1: Untrusted client → API     ├─► Resend (transactional email)
        T2: API → managed Postgres     ├─► Lemon Squeezy (payments, webhook HMAC)
        T3: API → vendor APIs          ├─► RevenueCat (mobile IAP, webhook HMAC)
        T4: Vendor webhook → API       ├─► Firebase Admin / FCM (push)
                                       ├─► DO Spaces / S3 (receipt blobs, SSE-S3)
                                       └─► Apple/Google IDPs (OIDC)
```

## Assets

| Asset | Sensitivity | Where it lives |
|---|---|---|
| User identity (email, providerId) | High | `users` table — providerId AES-256-GCM at-rest |
| Authentication credentials | Critical | bcrypt cost 12 in `users.password`; refresh JWT bcrypt-hashed in `users.refreshToken`; magic link sha256 |
| Subscription financial data | Medium-High | `subscriptions`, `payment_cards.last4` (PCI-exempt) |
| Receipt images | Medium | DO Spaces, ACL=private, SSE-S3 |
| Audit log (auth, deletion, export, billing) | High integrity | `audit_logs` (append-only) |
| AI uploads (audio, images) | Medium | not persisted server-side; sent to OpenAI just-in-time |
| Refresh tokens | Critical | bcrypt cost 12, absolute-expiry guard, rotated on refresh |

## STRIDE per Trust Boundary

### T1 — Untrusted client → API

| Category | Threat | Control |
|---|---|---|
| **S**poofing | Attacker logs in as victim | OIDC for Google/Apple (signature + audience pinned); bcrypt+throttle for password; magic-link sha256+15min+single-use; OTP CSPRNG+sha256+lockout |
| **T**ampering | Forged JWT | HS256 pinned (no `alg:none`); fail-closed JWT secrets; iss/aud/tv claims verified; tokenVersion bumped on logout |
| **R**epudiation | User denies action | `audit_logs` row per auth event with userId+IP+UA |
| **I**nfo disclosure | Tokens in URLs / logs | OAuth `/v2` callback uses URL fragment; `redactSecrets` strips token/code/JWT/Bearer/CRLF before any log or Telegram alert |
| **D**oS | Burst on AI / login | `@Throttle` 30/min on AI; per-email 5/15min on auth; global 300/min |
| **E**oP | IDOR | All resource queries filter by `req.user.id`; no anonymous mutation routes |

### T2 — API → managed Postgres

| Category | Threat | Control |
|---|---|---|
| **S** | Wrong server | TLS 1.2+ (operator-supplied DO managed-PG CA pinned via `DB_CA_CERT`/`DB_CA_PATH`; warning when unpinned) |
| **T** | Replay / SQL injection | TypeORM parameterised queries; raw SQL only in migrations under reviewer control |
| **I** | Backup leak | DO at-rest encryption; column-level AES-GCM for providerId / lemonSqueezyCustomerId; bcrypt for password / refreshToken |
| **D** | Pool exhaustion | Connection pool capped at 12 prod / 3 dev with explicit timeouts |
| **E** | Privilege creep | Single application role; migrations run via TypeORM CLI by ops only |

### T3 — API → vendor APIs

| Category | Threat | Control |
|---|---|---|
| **S** | DNS spoof / MitM | HTTPS only; `rejectUnauthorized: true` on all outbound (Postgres pinned, S3/Resend/OpenAI use Node defaults) |
| **T** | Vendor SDK CVE | Dependabot weekly; `npm audit --audit-level=high` gate in CI |
| **I** | Sensitive data to wrong vendor | Limited Use compliance for any future Gmail integration; OpenAI gets only what's needed for the prompt and is not persisted client-side |
| **D** | Vendor outage | Webhook idempotency + outbox pattern; queue retries via Bull |
| **E** | SSRF via user-supplied URL | `reports.service.fetchIcon` allowlist: HTTPS only, deny RFC1918/loopback/link-local/cloud-metadata, refuse redirects |

### T4 — Vendor webhook → API

| Category | Threat | Control |
|---|---|---|
| **S** | Forged webhook | HMAC SHA-256 over raw body (Lemon Squeezy); `timingSafeEqual` shared-secret (RevenueCat); Svix HMAC (Resend) |
| **T** | Replay | Webhook idempotency table; events deduped by event ID |
| **R** | Disputed bill state | Outbox + reconciliation cron + `audit_logs` for billing events |
| **I** | PII in webhook log | `redactSecrets` strips secrets before stdout / Telegram |
| **D** | Webhook flood | Rate-limited per provider; expensive paths queued via Bull |

## Out of Scope (current document)

- Hardware-key issuance for ops engineers (covered by separate ops runbook)
- Physical security of DO data centres (vendor responsibility)
- Supply-chain attacks on transitive npm packages beyond what
  Dependabot + Semgrep + CodeQL detect
- AI-prompt-injection from receipt OCR / voice transcription (tracked
  separately in `docs/AI_BEHAVIOR.md`)

## Open Items

| Priority | Item | Tracker |
|---|---|---|
| HIGH | OAuth `state` CSRF nonce on `/v2` callback | Batch 4 |
| MED | DNS-rebinding in `fetchIcon` allowlist (string check pre-resolution) | Batch 4 |
| MED | Tighten JWT iss/aud/tv to required after grace window (~30d post-Batch 1B) | TODO 2026-06 |
| LOW | `users.email` deterministic hash for searchable encryption | Future |
