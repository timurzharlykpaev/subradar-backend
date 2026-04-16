# SubRadar Architecture

High-level architecture of the SubRadar platform: clients, backend services, data stores, external integrations, and async processing.

## System diagram

```mermaid
flowchart TB
  %% ─── Clients ───
  subgraph Clients["Clients"]
    Mobile["📱 Mobile<br/>React Native + Expo"]
    Web["💻 Web<br/>React + Vite"]
    Landing["🌐 Landing<br/>subradar.ai"]
  end

  %% ─── Backend ───
  subgraph Backend["Backend — NestJS"]
    API["HTTP API<br/>/api/v1/*"]
    subgraph Modules["Domain modules"]
      Auth["auth"]
      Users["users"]
      Subs["subscriptions"]
      Billing["billing"]
      Analytics["analytics"]
      AI["ai"]
      FX["fx"]
      Catalog["catalog"]
      Notifications["notifications"]
      Workspace["workspace"]
    end
    Worker["BullMQ Worker<br/>jobs & crons"]
  end

  %% ─── Data ───
  subgraph Data["Data layer"]
    PG[("PostgreSQL<br/>TypeORM")]
    Redis[("Redis<br/>cache + BullMQ")]
  end

  %% ─── External integrations ───
  subgraph External["External services"]
    RC["RevenueCat<br/>iOS IAP"]
    LS["Lemon Squeezy<br/>Web checkout"]
    OpenAI["OpenAI<br/>GPT-4o / Whisper"]
    Google["Google OAuth"]
    Apple["Apple Sign In"]
    FXAPI["open.er-api.com<br/>FX rates"]
    FCM["Firebase FCM<br/>push"]
    Resend["Resend<br/>email"]
    DOSpaces["DO Spaces<br/>S3 storage"]
  end

  %% ─── Flows ───
  Mobile -->|HTTPS JSON| API
  Web -->|HTTPS JSON| API
  Landing -.->|marketing only| Web

  API --> Modules
  Modules --> PG
  Modules --> Redis
  Redis -. enqueue .-> Worker
  Worker --> PG
  Worker --> FCM
  Worker --> Resend

  Auth --> Google
  Auth --> Apple
  AI --> OpenAI
  Billing --> RC
  Billing --> LS
  FX --> FXAPI
  Subs --> DOSpaces

  classDef client fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef service fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef data fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef external fill:#f3f4f6,stroke:#6b7280,color:#111827

  class Mobile,Web,Landing client
  class API,Worker,Auth,Users,Subs,Billing,Analytics,AI,FX,Catalog,Notifications,Workspace service
  class PG,Redis data
  class RC,LS,OpenAI,Google,Apple,FXAPI,FCM,Resend,DOSpaces external
```

## Components

### Clients
- **Mobile** — React Native + Expo SDK 54. iOS + Android. Talks to backend via REST (`/api/v1`). Uses RevenueCat native SDK for IAP. Bundle ID `io.subradar.mobile`.
- **Web** — React + Vite SPA hosted on `app.subradar.ai`. Uses Lemon Squeezy Checkout for payments.
- **Landing** — Static marketing site at `subradar.ai`. No app logic.

### Backend (NestJS)
Single monorepo NestJS app deployed as a Docker container. Global prefix `/api/v1`. Swagger docs at `/api/docs` (dev only).

| Module | Responsibility |
|--------|----------------|
| `auth` | JWT issue/refresh, Google OAuth, Apple Sign In, Magic Link email, mobile token aliases |
| `users` | Profile (`/users/me`), FCM token, display currency/region |
| `subscriptions` | CRUD, cancel/pause/restore, receipts upload |
| `billing` | RevenueCat sync, Lemon Squeezy webhooks, plan gating (Free / Pro / Team) |
| `analytics` | Summary, monthly chart, by-category, by-card, upcoming |
| `ai` | `/ai/lookup`, `/ai/parse-screenshot`, `/ai/voice-to-subscription`, `/ai/suggest-cancel` (GPT-4o + Whisper) |
| `fx` | Cached FX rates via `open.er-api.com` with in-process fallback table |
| `catalog` | Curated directory of known subscription services (name, logo, plans) |
| `notifications` | Reminder scheduling, BullMQ enqueue, FCM + Resend delivery, per-user preferences |
| `workspace` | Team plans: invitations, members, seat assignment |

### Async / background
- **BullMQ worker** runs in-process (same container) subscribed to Redis queues:
  - `reminders` — daily at 09:00 user-local TZ, scans upcoming renewals
  - `weekly-digest` — Monday mornings for Pro users
  - `fx-refresh` — hourly, refresh cached FX rates
  - `ai-audit` — async post-processing for low-confidence AI results
  - `billing-reconcile` — nightly sync with RevenueCat / Lemon Squeezy

### Data stores
- **PostgreSQL** (DigitalOcean Managed) — primary store, TypeORM migrations run on container start. 7-day automated backups.
- **Redis** — BullMQ queues + short-lived caches (FX rates, AI lookup, magic-link tokens).

### External integrations
- **RevenueCat** — iOS In-App Purchases. Backend validates customer info via REST API.
- **Lemon Squeezy** — Web subscriptions. Webhook at `/api/v1/billing/webhook` (HMAC verified, raw body captured).
- **OpenAI** — GPT-4o for text/screenshot parsing, Whisper for voice transcription.
- **Google OAuth / Apple Sign In** — primary identity providers.
- **open.er-api.com** — free FX rate feed; backend caches and falls back to hard-coded table on outage.
- **Firebase FCM** — push to mobile.
- **Resend** — transactional email (magic link, receipts, weekly digest).
- **DigitalOcean Spaces** — S3-compatible object store for receipts and report PDFs.

## Request lifecycle (example: voice add)

```mermaid
sequenceDiagram
  participant M as Mobile
  participant API as Backend
  participant RDS as Redis
  participant O as OpenAI
  participant PG as Postgres

  M->>API: POST /ai/voice-to-subscription (multipart)
  API->>O: Whisper (audio → text)
  O-->>API: transcript
  API->>O: GPT-4o (extract fields)
  O-->>API: {name, amount, currency, ...}
  API->>RDS: cache AI lookup (24h)
  API-->>M: suggestion payload
  M->>API: POST /subscriptions (confirmed)
  API->>PG: INSERT subscription
  API->>RDS: enqueue reminder job
  API-->>M: 201 Created
```

## Deployment topology

- **Single droplet** on DigitalOcean (`46.101.197.19`), Docker Compose.
- Two containers per env: `subradar-api-prod` (port 8082) and `subradar-api-dev` (port 8083).
- Nginx-proxy handles TLS + routing (`api.subradar.ai`, `api-dev.subradar.ai`).
- Managed Postgres (DO) — separate service, private networking.
- Redis — self-hosted container on the same droplet.

## Related docs
- [Module boundaries](MODULE_BOUNDARIES.md) — NestJS module responsibilities & dependencies
- [API contracts](API_CONTRACTS.md) — all endpoints
- [Jobs and crons](JOBS_AND_CRONS.md) — scheduler specs
- [Runbook](RUNBOOK.md) — incident response
- [Status page](STATUS_PAGE.md) — uptime monitoring plan
