---
title: Архитектура
tags: [architecture, modules, guards, interceptors, middleware, state-machine, outbox, idempotency, audit]
sources:
  - src/app.module.ts
  - src/main.ts
  - src/common/filters/all-exceptions.filter.ts
  - src/common/redis.module.ts
  - src/common/telegram-alert.service.ts
  - src/common/middleware/correlation-id.middleware.ts
  - src/common/idempotency/idempotency.service.ts
  - src/common/audit/audit.service.ts
  - src/billing/outbox/outbox.service.ts
  - src/billing/state-machine/transitions.ts
  - src/billing/effective-access/effective-access.service.ts
updated: 2026-05-22
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

## Cross-cutting patterns

### Billing State Machine

Все billing-транзишены проходят через **pure-functional state machine** (`src/billing/state-machine/`):
- `transition(snapshot, event) -> snapshot` (`transitions.ts`) — детерминированная функция, кидает `InvalidTransitionError` если транзишн запрещён
- `reconcile(snapshot, rcSubscriber)` — для пост-фактум sync с RevenueCat
- `inferEventFromRcSnapshot(rcSub, current)` — из RC snapshot пытается вывести `BillingEvent`
- `UserBillingRepository.applyTransition(userId, event, { actor })` — единственная точка мутации `user_billing`: открывает tx, читает snapshot, гоняет через `transition`, пишет результат, audit, outbox, инвалидирует [[effective-access]] cache

Invalid-transition попадает в `billing_dead_letter` (queryable, replayable). См. [[billing-module]].

### Transactional Outbox

Side-effects (Amplitude, Telegram, FCM push) идут через `outbox_events`. Запись в БД + outbox-row живут в **одной транзакции** → не теряем события и не отправляем «призраков» от rollback'нутых tx. Воркер `OutboxWorker` (`@Cron(EVERY_10_SECONDS)`) с `FOR UPDATE SKIP LOCKED` + exponential backoff. Подробно — [[outbox]].

### EffectiveAccess резолвер

Единственный авторитет для `/billing/me`. Источник истины для всех guard'ов / features. Precedence: own > team > trial > grace > free. In-process TTL cache (60s, max 10k entries) с явным `invalidate(userId)` на каждый applyTransition. См. [[effective-access]].

### Idempotency middleware

`IdempotencyService.run(userId, endpoint, key, body, handler)` — RFC 9110-style. Replay с тем же body → cached response; с другим body → 409. TTL 24h. Используется на POST-эндпоинтах, которые мобилка может ретраить (purchase verify, sync). См. [[common-cross-cutting]].

### Audit logging

`audit_logs` — append-only лог чувствительных операций (account delete, plan changes, admin actions, billing transitions, gmail connect, workspace mutations). `AuditService.log()` никогда не throw'ит — провал audit не должен ломать бизнес-операцию. См. [[common-cross-cutting]].

### Correlation ID

`CorrelationIdMiddleware` — берёт `x-correlation-id` header или генерирует uuidv4, attach на `req.correlationId`, echo обратно. Mobile / web / ops могут коррелировать свои логи с серверными.

Подробнее: [[overview]], [[database]], [[deploy]], [[cron-jobs]], [[common-cross-cutting]]
