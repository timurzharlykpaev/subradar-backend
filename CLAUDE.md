# CLAUDE.md — subradar-backend

## Контекст проекта
NestJS backend для Subradar — AI-трекер подписок.
**Prod:** `https://api.subradar.ai/api/v1` (container `subradar-api-prod`, port 8082)
**Dev:** `https://api-dev.subradar.ai/api/v1` (container `subradar-api-dev`, port 8083)
**Server:** `root@46.101.197.19`, SSH key `~/.ssh/id_steptogoal`

## Стек
- NestJS + TypeScript (strict)
- TypeORM + PostgreSQL (DO Managed)
- JWT auth (access + refresh)
- Redis + BullMQ (queues)
- Resend (email — magic link)
- OpenAI (AI анализ подписок)
- Helmet, Throttler (120 req/min global)
- prom-client (метрики)

## Структура
```
src/
  auth/           # JWT, Google OAuth (access_token flow), Magic Link
    dto/
    entities/     # User, RefreshToken
    guards/       # JwtAuthGuard
    strategies/   # jwt.strategy
  subscriptions/  # CRUD подписок
    dto/
    entities/     # Subscription
  payment-cards/  # Платёжные карты
    dto/
    entities/     # PaymentCard
  analytics/      # Аналитика расходов
  reports/        # Отчёты
    dto/
    entities/     # Report
  workspace/      # Workspace / организации
    dto/
    entities/     # Workspace, WorkspaceMember
  billing/        # Биллинг планов
    dto/
  receipts/       # Чеки/квитанции
    entities/     # Receipt
  ai/             # OpenAI интеграция
    dto/
  users/          # Профиль
    dto/
    entities/     # User
  notifications/  # Email уведомления (Resend)
    entities/
  storage/        # Файлы
  common/         # Декораторы, guards, filters, interceptors, types
  config/         # Конфиги env
  migrations/     # TypeORM миграции
```

## Правила кода

### DTO и валидация
- `forbidNonWhitelisted: true` глобально
- Все поля через class-validator декораторы
- Новая фича = новый DTO файл

### Энумы (ВАЖНО — только UPPERCASE)
```ts
// BillingCycle
MONTHLY | YEARLY | WEEKLY | QUARTERLY | LIFETIME | ONE_TIME

// SubscriptionStatus
ACTIVE | PAUSED | CANCELLED | TRIAL

// Category
STREAMING | AI_SERVICES | INFRASTRUCTURE | MUSIC | GAMING
PRODUCTIVITY | HEALTH | NEWS | OTHER
```
**Фронт и мобилка завязаны на эти значения — не менять.**

### Google OAuth
- Использует `access_token` flow (не `id_token`)
- Endpoint: `POST /auth/google/token` принимает `{ accessToken }` или `{ idToken }`
- Бэкенд сам запрашивает профиль через Google userinfo API

### Magic Link
- `POST /auth/magic-link` → отправляет письмо через Resend
- Email провайдер: **Resend** (не Mailgun, не SendGrid)
- `RESEND_API_KEY` обязателен в env

### TypeORM
- `synchronize: false` в prod
- `migrationsRun: true` в prod
- `ssl: { rejectUnauthorized: false }` для DO PostgreSQL
- `NODE_TLS_REJECT_UNAUTHORIZED=0` в env
- Новая сущность = новая миграция

### Аутентификация
- `JwtAuthGuard` на все защищённые роуты
- `@Public()` для открытых
- Refresh token rotation

### Rate limiting
- Global: 120 req/min (ThrottlerGuard)
- Не убирать

## API контракт (фронт + мобилка завязаны)
```
POST /auth/google/token     { accessToken } | { idToken }
POST /auth/magic-link       { email }
GET  /auth/magic-callback   ?token=xxx
POST /auth/refresh          { refreshToken }
GET  /auth/me
GET  /subscriptions
POST /subscriptions
PATCH /subscriptions/:id
DELETE /subscriptions/:id
GET  /subscriptions/upcoming
GET  /payment-cards
POST /payment-cards
GET  /analytics/summary
GET  /analytics/by-category
GET  /reports
GET  /workspace
```

## Git workflow
```bash
git checkout dev && git pull
git checkout -b feat/xxx
# ... работа ...
git checkout dev && git merge feat/xxx
git push origin dev
git branch -d feat/xxx && git push origin --delete feat/xxx
# main branch → prod (только по запросу)
```
- `dev` → auto-deploy dev
- `main` → auto-deploy prod

## Деплой (CI/CD через GitHub Actions)
Docker image → GHCR (`ghcr.io/timurzharlykpaev/subradar-backend`)
Secret: `GHCR_TOKEN` (не `GITHUB_TOKEN`)

## Env (prod `/opt/subradar/.env.prod`)
```
DB_HOST=dbaas-db-4327922-do-user-...
DB_SSL=true
NODE_TLS_REJECT_UNAUTHORIZED=0
JWT_ACCESS_SECRET=sr_acc_...
JWT_REFRESH_SECRET=sr_ref_...
OPENAI_API_KEY=sk-proj-...
GOOGLE_CLIENT_ID=140914936328-...
GOOGLE_CLIENT_SECRET=GOCSPX-...
RESEND_API_KEY=re_YHjEcK5A_...
APP_URL=https://app.subradar.ai
CORS_ORIGINS=https://app.subradar.ai,https://app-dev.subradar.ai
REDIS_URL=redis://subradar-redis:6379
```

## Тесты
- Jest + @nestjs/testing
- Каждый новый сервис = unit тест
- `npx tsc --noEmit` перед коммитом

## ⛔ НЕ ТРОГАТЬ без явного запроса
- Enum значения (UPPERCASE) — ломает фронт и мобилку
- `forbidNonWhitelisted` настройка
- Email провайдер (всегда Resend)
- Существующие миграции в `src/migrations/`
- Порты: prod=8082, dev=8083

## Документация
Подробная спецификация продукта в папке `docs/`:
- `docs/PRODUCT_OVERVIEW.md` — обзор продукта, принципы, аудитория, монетизация, MVP критерии
- `docs/DOMAIN_MODEL.md` — все сущности и их поля, lifecycle статусов
- `docs/API_CONTRACTS.md` — все API endpoints с примерами
- `docs/BILLING_RULES.md` — тарифы Free/Pro/Team, логика триала
- `docs/AI_BEHAVIOR.md` — правила поведения AI, confidence levels, fallback
- `docs/STATE_RULES.md` — жизненный цикл подписки, empty states
- `docs/MODULE_BOUNDARIES.md` — границы NestJS модулей
- `docs/JOBS_AND_CRONS.md` — фоновые задачи и cron jobs
- `docs/AI_PIPELINES.md` — AI пайплайны (text, screenshot, matcher, insights, audit)

## Agent Rules
1. Не ломать существующий Google auth
2. Не добавлять новые библиотеки без явной причины
3. Любая AI-фича должна иметь fallback UI
4. Любой новый экран должен быть связан с navigation map
5. Любой новый API endpoint должен быть отражён в docs/API_CONTRACTS.md
6. Любая тяжёлая операция должна быть async/job-based (BullMQ)
7. Любые финансовые данные требуют user confirmation
8. Любая новая сущность должна иметь status lifecycle
9. Любая продуктовая фича должна иметь analytics events
10. Не реализовывать Release 2/3 фичи, пока не стабилен MVP (Release 1)

## Прогресс
См. `PROGRESS.md` в корне репозитория.
