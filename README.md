# SubRadar AI Backend

AI-powered subscription management backend built with NestJS.

## Documentation

See `docs/` folder for full product specification:
- [Architecture](docs/ARCHITECTURE.md) — system diagram, components, deployment topology
- [Product Overview](docs/PRODUCT_OVERVIEW.md) — vision, principles, monetization, MVP criteria
- [Domain Model](docs/DOMAIN_MODEL.md) — entities, enums, status lifecycle
- [API Contracts](docs/API_CONTRACTS.md) — all endpoints with examples
- [Billing Rules](docs/BILLING_RULES.md) — Free/Pro/Team plans, trial logic
- [AI Behavior](docs/AI_BEHAVIOR.md) — AI rules, confidence, fallbacks
- [State Rules](docs/STATE_RULES.md) — subscription lifecycle, empty states
- [Module Boundaries](docs/MODULE_BOUNDARIES.md) — NestJS module responsibilities
- [Jobs and Crons](docs/JOBS_AND_CRONS.md) — background tasks
- [AI Pipelines](docs/AI_PIPELINES.md) — text/screenshot/matcher/insights/audit pipelines
- [Runbook](docs/RUNBOOK.md) — incident response procedures
- [Feature Flags](docs/FEATURE_FLAGS.md) — toggle strategy & roadmap
- [Status Page](docs/STATUS_PAGE.md) — uptime monitoring plan

## Stack

- **Framework:** NestJS + TypeScript
- **Database:** PostgreSQL (TypeORM)
- **Cache/Queue:** Redis (Bull)
- **Auth:** JWT, Passport (Google OAuth, Apple, Magic Link)
- **AI:** OpenAI GPT-4o (lookup, screenshot parsing, voice-to-subscription)
- **Storage:** DigitalOcean Spaces (S3-compatible)
- **Payments:** Lemon Squeezy
- **Email:** Resend
- **Push:** Firebase FCM
- **PDF:** PDFKit
- **API Docs:** Swagger

## Modules

| Module | Description |
|--------|-------------|
| `auth` | JWT + Google OAuth + Apple + Magic Link email |
| `users` | User management, profile |
| `subscriptions` | Full CRUD, AI-enriched subscription tracking |
| `payment-cards` | Virtual card management (nickname, last4, brand, color) |
| `receipts` | File upload to DO Spaces |
| `ai` | GPT-4o: lookup, screenshot parse, voice-to-subscription, cancel URL |
| `analytics` | Summary, monthly chart, by-category, upcoming, by-card |
| `reports` | PDF report generation (summary, detailed, tax) |
| `notifications` | Bull queue, Firebase FCM push, Resend email |
| `billing` | Lemon Squeezy webhooks + checkout |

## Setup

1. Copy environment file:
```bash
cp .env.example .env
```

2. Fill in your environment variables in `.env`

3. Install dependencies:
```bash
npm install
```

4. Start PostgreSQL and Redis (Docker):
```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=subradar postgres:16
docker run -d -p 6379:6379 redis:alpine
```

5. Start development server:
```bash
npm run start:dev
```

## API Documentation

Once running, visit: `http://localhost:3000/api/docs`

## Key Endpoints

### Auth
- `POST /api/v1/auth/register` — Email/password registration
- `POST /api/v1/auth/login` — Login
- `GET  /api/v1/auth/google` — Google OAuth
- `POST /api/v1/auth/apple` — Apple Sign In
- `POST /api/v1/auth/magic-link` — Send magic link
- `GET  /api/v1/auth/magic?token=...` — Verify magic link
- `POST /api/v1/auth/refresh` — Refresh tokens
- `POST /api/v1/auth/logout` — Logout

### Subscriptions
- `GET  /api/v1/subscriptions` — List all
- `POST /api/v1/subscriptions` — Create
- `GET  /api/v1/subscriptions/:id` — Get one
- `PATCH /api/v1/subscriptions/:id` — Update
- `DELETE /api/v1/subscriptions/:id` — Delete

### Analytics
- `GET /api/v1/analytics/summary?month&year`
- `GET /api/v1/analytics/monthly?months=12`
- `GET /api/v1/analytics/by-category?month&year`
- `GET /api/v1/analytics/upcoming?days=7`
- `GET /api/v1/analytics/by-card`

### AI
- `POST /api/v1/ai/lookup` — Lookup service by name
- `POST /api/v1/ai/parse-screenshot` — Parse subscription screenshot
- `POST /api/v1/ai/voice` — Voice to subscription
- `POST /api/v1/ai/suggest-cancel` — Get cancel URL + steps

### Reports
- `POST /api/v1/reports/generate` — Generate report `{from, to, type}`
- `GET  /api/v1/reports` — List reports
- `GET  /api/v1/reports/:id/download` — Download PDF

### Billing
- `POST /api/v1/billing/webhook` — Lemon Squeezy webhook
- `POST /api/v1/billing/checkout` — Create checkout session

## Subscription Categories

`STREAMING` `AI_SERVICES` `INFRASTRUCTURE` `PRODUCTIVITY` `MUSIC` `GAMING` `NEWS` `HEALTH` `OTHER`

## Billing Periods

`MONTHLY` `YEARLY` `WEEKLY` `QUARTERLY` `LIFETIME` `ONE_TIME`

## Report Types

| Type | Description |
|------|-------------|
| `summary` | High-level totals and category breakdown |
| `detailed` | Full subscription list with all fields |
| `tax` | Tax-ready table with Business expense column |

---

## Deployment

### Server
- **IP:** `46.101.197.19` (DigitalOcean)
- **SSH:** `ssh -i ~/.ssh/id_steptogoal root@46.101.197.19`
- **Docker Compose:** `/opt/subradar/docker-compose.yml`

### Environments

| Branch | Container | Port | API URL | Database |
|--------|-----------|------|---------|----------|
| `dev` | `subradar-api-dev` | 8083 | `api-dev.subradar.ai` | `subradar_dev` |
| `main` | `subradar-api-prod` | 8082 | `api.subradar.ai` | `subradar` |

### Dev deploy (automatic)

```bash
git checkout dev
# make changes
git add . && git commit -m "feat: ..."
git push origin dev
# → GitHub Actions: build Docker image → push GHCR → deploy to api-dev.subradar.ai
```

### Prod deploy (automatic on push to main)

```bash
git checkout main
git merge dev
git push origin main
# → GitHub Actions: build Docker image → push GHCR → deploy to api.subradar.ai
# Migrations run automatically on startup
```

### Manual deploy (emergency)

```bash
ssh -i ~/.ssh/id_steptogoal root@46.101.197.19
cd /opt/subradar
docker compose pull subradar-api-prod
docker compose up -d --force-recreate --no-deps subradar-api-prod
```

### Migrations

Migrations run automatically when container starts (`migrationsRun: true`).

```bash
# Create new migration (locally)
npm run migration:generate -- src/migrations/MigrationName

# Run migrations manually on server
ssh -i ~/.ssh/id_steptogoal root@46.101.197.19
docker exec subradar-api-prod npm run migration:run
```

**Rules:**
- Migrations must be backward-compatible (add columns with defaults, never drop)
- Test migration on `dev` before merging to `main`
- To rollback: `docker exec subradar-api-prod npm run migration:revert`

### Rollback

```bash
ssh -i ~/.ssh/id_steptogoal root@46.101.197.19
cd /opt/subradar

# Pull previous image version
docker compose stop subradar-api-prod
docker run --env-file .env.prod ghcr.io/timurzharlykpaev/subradar-backend:<previous-tag>
```

Or revert the commit and push — CI will redeploy automatically.

### Logs

```bash
ssh -i ~/.ssh/id_steptogoal root@46.101.197.19

# Prod logs
docker logs --tail 100 -f subradar-api-prod

# Dev logs
docker logs --tail 100 -f subradar-api-dev

# All containers status
docker ps
```

### Monitoring

- **Grafana:** `https://grafana.steptogoal.io` (admin/Admin123!)
- **Telegram alerts:** `@StepToGoalAlertbot` — runtime errors auto-reported
- **Auto-restart:** error-monitor restarts container on 5xx errors (5 min debounce)
- **Uptime:** see [docs/STATUS_PAGE.md](docs/STATUS_PAGE.md) for Better Uptime setup plan

---

## Environment setup

See [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md) for complete environment variable reference (database, Redis, OAuth, RevenueCat, Lemon Squeezy, OpenAI, FCM, Resend, DO Spaces).

Copy template:
```bash
cp .env.example .env
```

Each variable is documented in `.env.example` with format, example, and whether it is required.

---

## Demo account for App Store review

Apple / Play reviewers use a gated demo account that bypasses OTP. The account is guarded by the backend flag `ENABLE_REVIEW_ACCOUNT=true` (only enabled on prod).

| Field | Value |
|-------|-------|
| Email | `review@subradar.ai` |
| Magic-link code | `000000` |
| Plan | Pro (full access) |

Test flow for reviewers:
1. Open app → tap "Continue with Email" → enter `review@subradar.ai`
2. Enter code `000000`
3. Dashboard loads with seeded subscriptions → add one more → open Analytics

**Rotation:** if leaked, change `REVIEW_ACCOUNT_CODE` env var and redeploy. Account data is refreshed by the `review-account-refresh` cron each midnight.

---

## Backup & recovery

**Database:**
- Managed PostgreSQL on DigitalOcean — **7-day automated backups** (daily snapshots, point-in-time recovery).
- Restore via DO console → Databases → `subradar-prod-db` → Backups → Restore.
- Logical backups (pg_dump) are not configured; rely on DO snapshots.

**Object storage (receipts, PDFs):**
- DO Spaces has versioning enabled on the `subradar-receipts` bucket.
- Lifecycle rule retains non-current versions 30 days.

**Redis:**
- Ephemeral. Jobs are re-enqueued on container restart. No backups needed.

**Config / secrets:**
- `.env.prod` lives on the droplet (`/opt/subradar/.env.prod`). Copy offline to a password manager quarterly.

**Recovery drill:** once per quarter — restore staging from prod backup to verify procedure works.

---

## Rollback procedure

### Backend rollback

Option A — revert commit (preferred):
```bash
git revert <bad-commit-sha>
git push origin main
# CI redeploys automatically
```

Option B — re-deploy previous image (emergency, faster):
```bash
ssh -i ~/.ssh/id_steptogoal root@46.101.197.19
cd /opt/subradar

# List recent images
docker images ghcr.io/timurzharlykpaev/subradar-backend

# Pin compose to previous tag
sed -i 's|subradar-backend:latest|subradar-backend:<previous-sha>|' docker-compose.yml
docker compose up -d --force-recreate --no-deps subradar-api-prod
```

Option C — revert DB migration:
```bash
docker exec subradar-api-prod npm run migration:revert
```

### Mobile rollback

**OTA (immediate, JS-only changes):**
```bash
# List recent updates
eas update:list --branch production

# Roll back to a previous update (publishes a new "revert" update)
eas update --branch production --republish --group <previous-group-id>
```

**Native rollback (requires TestFlight resubmit):**
```bash
# List finished builds
eas build:list --platform ios --status finished

# Submit an older build to App Store Connect
eas submit --platform ios --id <older-build-id>
# Promote that build via App Store Connect → Ready for Sale
```

> Note: once a build is live in the App Store, full rollback requires a new submission. OTA is the fast path for anything that doesn't touch native code.
