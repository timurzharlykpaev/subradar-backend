# SubRadar AI Backend

AI-powered subscription management backend built with NestJS.

## Documentation

See `docs/` folder for full product specification:
- [Product Overview](docs/PRODUCT_OVERVIEW.md) — vision, principles, monetization, MVP criteria
- [Domain Model](docs/DOMAIN_MODEL.md) — entities, enums, status lifecycle
- [API Contracts](docs/API_CONTRACTS.md) — all endpoints with examples
- [Billing Rules](docs/BILLING_RULES.md) — Free/Pro/Team plans, trial logic
- [AI Behavior](docs/AI_BEHAVIOR.md) — AI rules, confidence, fallbacks
- [State Rules](docs/STATE_RULES.md) — subscription lifecycle, empty states
- [Module Boundaries](docs/MODULE_BOUNDARIES.md) — NestJS module responsibilities
- [Jobs and Crons](docs/JOBS_AND_CRONS.md) — background tasks
- [AI Pipelines](docs/AI_PIPELINES.md) — text/screenshot/matcher/insights/audit pipelines

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
