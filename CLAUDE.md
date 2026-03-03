# SubRadar Backend — Claude Code Guide

## Язык
**Всегда отвечай на русском языке.**

## Проект
SubRadar AI — NestJS REST API для управления подписками с AI-возможностями.

**Стек:** NestJS 10, TypeScript (strict), TypeORM + PostgreSQL, Redis (Bull Queue), JWT Auth, Passport.js, Swagger, AWS S3 (DO Spaces), OpenAI GPT-4o, Lemon Squeezy (billing), Helmet, class-validator.

**Запущен на:** DigitalOcean `46.101.197.19`
- Prod: порт `3100`, домен `api.subradar.ai`
- Dev: порт `3101`, домен `api-dev.subradar.ai`

## Структура
```
src/
├── ai/              # GPT-4o: lookup-service, parse-screenshot, voice, suggest-cancel
├── analytics/       # Аналитика подписок (summary, monthly, by-category, by-card, upcoming)
├── auth/            # JWT + Google OAuth + Apple + Magic Link
│   ├── dto/         # RegisterDto, LoginDto, MagicLinkDto, RefreshTokenDto
│   ├── entities/    # RefreshToken entity
│   ├── guards/      # JwtAuthGuard, GoogleAuthGuard
│   └── strategies/  # jwt.strategy, google.strategy
├── billing/         # Lemon Squeezy (plans, checkout, webhook, cancel)
├── common/          # Общие утилиты, декораторы, фильтры
├── config/          # ConfigModule, .env загрузка
├── notifications/   # FCM, push settings (стаб)
├── payment-cards/   # CRUD карт оплаты
├── receipts/        # Загрузка чеков на DO Spaces
├── reports/         # Генерация PDF/CSV отчётов (Bull Queue)
├── storage/         # DO Spaces S3 клиент
├── subscriptions/   # CRUD подписок + nested receipts routes
├── users/           # Профиль пользователя (GET/PATCH /users/me)
├── workspace/       # Team workspace (следующая итерация)
├── migrations/      # TypeORM миграции
├── data-source.ts   # TypeORM DataSource конфиг
└── main.ts          # Bootstrap (Helmet, CORS, ValidationPipe, Swagger)
```

## Критичные правила

### Архитектура
- **Controller** — только роутинг и трансформация запроса/ответа. Бизнес-логика в **Service**.
- Использовать **DTO** с `class-validator` для всех входящих данных.
- **Никогда** не делать прямые SQL-запросы — только через TypeORM Repository.
- Все защищённые роуты должны иметь `@UseGuards(JwtAuthGuard)` и `@ApiBearerAuth()`.

### Безопасность
- `ValidationPipe` с `whitelist: true, forbidNonWhitelisted: true` — **глобально**.
- CORS разрешён только для `CORS_ORIGINS` из `.env`.
- DO Spaces URLs для чеков — **всегда signed** (приватные).
- Lemon Squeezy webhooks — **HMAC верификация** обязательна.
- Rate limiting через `@nestjs/throttler`.

### Типы
- **Никогда не использовать `any`**. TypeScript strict mode.
- Enums для статусов, категорий, ролей — через TypeORM enum columns.

### Миграции
- При изменении entity — **всегда создавать миграцию**: `npm run migration:generate`
- Не изменять существующие миграции — только новые.
- Применить: `npm run migration:run`

### Эндпоинты — соглашения
- `GET /auth/me` — читать профиль
- `PATCH /users/me` — **обновлять** профиль (не PATCH /auth/me!)
- Вложенные роуты чеков: `/subscriptions/:id/receipts` (не standalone `/receipts`)
- Mobile-only алиасы: `/auth/google/mobile`, `/auth/verify`, `/ai/voice-to-subscription`

## Команды
```bash
npm run start:dev         # Дев-сервер с watch (порт 3000 внутри Docker)
npm run build             # Сборка
npm run start:prod        # Запуск production
npm run migration:generate # Генерация новой миграции
npm run migration:run     # Применить миграции
npm run migration:revert  # Откатить последнюю миграцию
npm run lint              # ESLint
npm run test              # Unit тесты
npm run test:e2e          # E2E тесты
```

## Переменные окружения (`.env`)

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=subradar
DB_PASSWORD=<password>
DB_DATABASE=subradar

# Auth
JWT_SECRET=<secret>
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=<secret>
JWT_REFRESH_EXPIRES_IN=30d

# Google OAuth
GOOGLE_CLIENT_ID=<client_id>
GOOGLE_CLIENT_SECRET=<client_secret>
GOOGLE_CALLBACK_URL=https://api.subradar.ai/api/v1/auth/google/callback

# Magic Link / Email
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=<api_key>
EMAIL_FROM=noreply@subradar.ai
MAGIC_LINK_SECRET=<secret>
FRONTEND_URL=https://app.subradar.ai

# OpenAI
OPENAI_API_KEY=<key>

# DO Spaces (S3)
DO_SPACES_KEY=<key>
DO_SPACES_SECRET=<secret>
DO_SPACES_ENDPOINT=fra1.digitaloceanspaces.com
DO_SPACES_BUCKET=subradar
DO_SPACES_REGION=fra1

# Lemon Squeezy
LEMON_SQUEEZY_API_KEY=<key>
LEMON_SQUEEZY_STORE_ID=<id>
LEMON_SQUEEZY_WEBHOOK_SECRET=<secret>

# Redis (Bull Queue)
REDIS_HOST=localhost
REDIS_PORT=6379

# CORS
CORS_ORIGINS=https://app.subradar.ai,https://subradar.ai

PORT=3000
NODE_ENV=production
```

## Docker

```yaml
# docker-compose.subradar.yml
services:
  subradar-api-prod:
    image: subradar-backend
    ports: ["3100:3000"]
    env_file: /opt/subradar/.env.prod

  subradar-api-dev:
    ports: ["3101:3000"]
    env_file: /opt/subradar/.env.dev

  subradar-db:
    image: postgres:16

  subradar-redis:
    image: redis:7-alpine
```

## Swagger / Docs

После запуска: `http://localhost:3000/api/docs`

## Модули — статус реализации

| Модуль | Статус | Примечание |
|--------|--------|-----------|
| `auth` | ✅ Готов | Google, Magic Link, Refresh |
| `users` | ✅ Готов | GET/PATCH /users/me |
| `subscriptions` | ✅ Готов | CRUD + cancel/pause + receipts |
| `analytics` | ✅ Готов | summary, monthly, by-category, by-card, upcoming |
| `payment-cards` | ✅ Готов | CRUD |
| `ai` | ✅ Готов | lookup, parse-screenshot, voice |
| `reports` | ✅ Готов | generate, status, download (Bull Queue) |
| `billing` | ✅ Готов | Lemon Squeezy plans, checkout, webhook |
| `receipts` | ✅ Готов | через nested `/subscriptions/:id/receipts` |
| `notifications` | ⚠️ Стаб | FCM не интегрирован |
| `workspace` | 🔜 Следующий | По ТЗ — командный план |

## ТЗ

Полное техническое задание: `TZ.md` в корне репозитория.
