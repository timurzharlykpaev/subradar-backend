---
title: Архитектура
tags: [architecture, modules, guards, interceptors, middleware]
sources:
  - src/app.module.ts
  - src/main.ts
  - src/common/filters/all-exceptions.filter.ts
  - src/common/redis.module.ts
  - src/common/telegram-alert.service.ts
updated: 2026-04-16
---

# Архитектура

## Модульная структура

AppModule — корневой модуль, импортирует все feature-модули:

```
AppModule
├── ConfigModule.forRoot()          # Глобальный конфиг (.env)
├── RedisModule                     # Общий Redis-клиент (ioredis)
├── ThrottlerModule                 # Rate limiting (300 req/min)
├── TypeOrmModule.forRootAsync()    # PostgreSQL
├── BullModule.forRootAsync()       # Redis-backed job queues
├── ScheduleModule.forRoot()        # Cron jobs (@nestjs/schedule)
│
├── AuthModule                      # Аутентификация
├── UsersModule                     # Профиль пользователя
├── SubscriptionsModule             # CRUD подписок
├── PaymentCardsModule              # Платёжные карты
├── ReceiptsModule                  # Чеки/квитанции
├── AiModule                        # AI-фичи (OpenAI)
├── AnalyticsModule                 # Аналитика расходов
├── AnalysisModule                  # Глубокий AI-анализ (jobs)
├── ReportsModule                   # PDF/CSV отчёты
├── NotificationsModule             # Push + Email
├── BillingModule                   # Планы, RevenueCat, LS
├── WorkspaceModule                 # Организации/команды
├── StorageModule                   # Файловое хранилище (DO Spaces)
├── RemindersModule                 # Cron-напоминания
├── FxModule                        # Курсы валют
└── CatalogModule                   # Каталог сервисов
```

## Глобальные компоненты

### Guards

| Guard | Область | Описание |
|-------|---------|----------|
| `ThrottlerGuard` | APP_GUARD (global) | 300 req/min на все эндпоинты |
| `JwtAuthGuard` | Per-controller | Проверка JWT access token |
| `GoogleAuthGuard` | Auth endpoints | OAuth2 через Passport |
| `SubscriptionLimitGuard` | POST /subscriptions | Проверка лимита подписок по плану |

### Filters

| Filter | Описание |
|--------|----------|
| `AllExceptionsFilter` | Глобальный exception handler — форматирует ответ, отправляет Telegram-алерт при 5xx |

Формат ответа при ошибке:
```json
{
  "success": false,
  "statusCode": 500,
  "timestamp": "2026-04-16T10:00:00.000Z",
  "path": "/api/v1/...",
  "message": "..."
}
```

### Pipes

| Pipe | Описание |
|------|----------|
| `ValidationPipe` | Глобальный — `whitelist: true`, `transform: true`, `forbidNonWhitelisted: true` |

**Критично:** `forbidNonWhitelisted: true` — клиент получит 400 если пошлёт неизвестные поля в body.

### Middleware / настройки

| Middleware | Описание |
|-----------|----------|
| `helmet()` | Security headers (COOP disabled для Google OAuth popup) |
| `bodyParser.json` | Лимит 10MB (для audio/image uploads) |
| `rawBody` capture | На `/api/v1/billing/webhook` для HMAC-верификации Lemon Squeezy |
| CORS | Whitelist: `CORS_ORIGINS` env, разрешены запросы без origin (mobile, curl) |

## Redis

Единый Redis-клиент (`REDIS_CLIENT` injection token), используется:
- **Кеширование** — аналитика (`analytics:*`), AI-ответы (`ai:*`), FX-курсы (`fx:latest`)
- **BullMQ очереди** — notifications, analysis, catalog-refresh
- **Rate limiting** — auth lockout (`auth:lockout:*`), OTP (`otp:*`)
- **Дедупликация** — AI lookup lock (`ai:lookup:lock:*`), analysis debounce

Bull queues изолированы по NODE_ENV: prefix `bull:production` / `bull:development`.

## Telegram-алерты

`TelegramAlertService` — отправляет алерты в Telegram при 5xx ошибках на production.
Дедупликация: одинаковые ошибки не отправляются повторно в течение 5 минут.

Исключённые пути: `/api/v1/auth/me`, `/health`, `/metrics`, `/favicon`.

## Swagger

Доступен только в dev (`NODE_ENV !== 'production'`):
- URL: `/api/docs`
- Автоматически генерируется из `@ApiTags`, `@ApiBearerAuth`

Подробнее: [[overview]], [[database]], [[deploy]]
