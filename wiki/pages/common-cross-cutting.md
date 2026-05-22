---
title: Cross-cutting (guards, decorators, middleware, audit, idempotency)
tags: [common, guards, decorators, middleware, audit, idempotency, telegram, heartbeat]
sources:
  - src/common/guards/plan.guard.ts
  - src/common/guards/roles.guard.ts
  - src/common/guards/ws-jwt.guard.ts
  - src/common/decorators/current-user.decorator.ts
  - src/common/decorators/require-plan-capability.decorator.ts
  - src/common/decorators/roles.decorator.ts
  - src/common/middleware/correlation-id.middleware.ts
  - src/common/audit/audit.service.ts
  - src/common/audit/audit-log.entity.ts
  - src/common/idempotency/idempotency.service.ts
  - src/common/idempotency/idempotency-key.entity.ts
  - src/common/telegram-alert.service.ts
  - src/common/heartbeat.service.ts
  - src/common/cron/run-cron-handler.ts
  - src/common/crypto/aes-gcm-transformer.ts
  - src/common/filters/all-exceptions.filter.ts
  - src/common/interceptors/cache-control.interceptor.ts
  - src/common/interceptors/transform.interceptor.ts
  - src/common/utils/pii.ts
  - src/common/redis.module.ts
  - src/common/antivirus/antivirus.service.ts
updated: 2026-05-22
---

# Cross-cutting (`src/common/`)

Общие компоненты, используемые во всех модулях.

## Guards

### `JwtAuthGuard` (`auth/guards/`)
Per-controller, проверяет JWT access token. См. [[auth-module]].

### `PlanGuard` (`common/guards/plan.guard.ts`)
Reads `@RequirePlanCapability` метаданные из handler. Без декоратора → pass through. Иначе:

- `canCreateOrg` → требует Team plan (`access.limits.canCreateOrg`)
- `canInvite` → требует Pro или Team
- `unlimitedSubs` → reserved (для будущих эндпоинтов)

Резолвит через [[effective-access]] (`EffectiveAccessResolver.resolve(userId)`). **Не** читает `user.plan` напрямую.

Composable: ставится после `JwtAuthGuard` (нужен `req.user.id`):
```ts
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlanCapability('canCreateOrg')
```

### `RolesGuard` (`common/guards/roles.guard.ts`)
Workspace-RBAC. `@Roles(WorkspaceMemberRole.OWNER)` — проверка по `members[].role`.

### `WsJwtGuard` (`ws-jwt.guard.ts`)
Для WebSocket-эндпоинтов (если будут — пока не используется).

### `RequireProGuard` (`auth/guards/require-pro.guard.ts`)
Pro/Organization gating через EffectiveAccess. Стэшит `req.proAccess` для downstream (см. [[gmail-module]] — daily quota tier).

### `SubscriptionLimitGuard`
Per-route на `POST /subscriptions` — проверка лимита по плану.

## Decorators

### `@CurrentUser()` (`common/decorators/current-user.decorator.ts`)
Sugar для `req.user` в controller methods.

### `@Roles(...roles)` (`common/decorators/roles.decorator.ts`)
Метаданные для `RolesGuard`. Используется в [[workspace-module]].

### `@RequirePlanCapability(cap)` (`common/decorators/require-plan-capability.decorator.ts`)
Метаданные для `PlanGuard`:
```ts
export type PlanCapability = 'canCreateOrg' | 'canInvite' | 'unlimitedSubs';
```

## Middleware

### `CorrelationIdMiddleware`
- Если есть `x-correlation-id` header → trim + slice 128 → reuse
- Иначе → uuidv4
- Attach `req.correlationId`
- Echo обратно через `x-correlation-id` response header (client может коррелировать)

Mounted globally в `AppModule.configure(consumer)`.

### `helmet()`, `bodyParser.json (10MB)`, `rawBody` capture для LS webhook
См. [[architecture]] → middleware.

## AuditService (`common/audit/`)

Append-only log в `audit_logs`:

| Поле | Тип | Описание |
|------|-----|----------|
| `userId` | UUID nullable | |
| `action` | varchar(64) (indexed) | `'billing.trial_activated'`, `'workspace.created'`, etc. |
| `resourceType` | varchar(64) | `'workspace'`, `'user_trial'`, ... |
| `resourceId` | varchar(191) | |
| `metadata` | jsonb | denormalized op-specific |
| `ipAddress`, `userAgent` | varchar | |
| `createdAt` | timestamptz (indexed) | |

`AuditService.log(entry)` **never throws** — выпадение audit не должно ломать бизнес-операцию (warn в логи). Пустые поля → null.

Используется в: trials, workspace, gmail, billing webhooks, deleteAccount, admin actions.

## IdempotencyService (`common/idempotency/`)

Реализует request-level idempotency (RFC 9110 `Idempotency-Key`).

### Сущность IdempotencyKey (`idempotency_keys`)

UNIQUE(`userId`, `endpoint`, `key`).

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID PK | |
| `userId` | UUID | |
| `endpoint` | varchar(64) | route id |
| `key` | varchar(128) | `Idempotency-Key` header value |
| `statusCode` | int | persisted response code |
| `responseBody` | jsonb | persisted response body |
| `requestHash` | varchar(64) | SHA-256 of request body (first 32 chars) |
| `createdAt` | timestamp (indexed) | TTL marker |

### `run(userId, endpoint, key, body, handler)`

- First call → run handler, INSERT row, return response
- Replay (SAME requestHash) → return cached response (`cached: true`) без re-running side effect
- Replay (DIFFERENT requestHash) → throw `ConflictException` (отказ silently trace as same op)
- Records > 24h → expired, overwrite as first call
- Race on first call → unique-violation `23505` perched, re-read winner row

### Cron cleanup
Daily (`@Cron('0 3 * * *')` или подобный — в [[cron-jobs]]) — удаляет rows старше 24h.

## TelegramAlertService (`common/telegram-alert.service.ts`)

Отправляет alerts в Telegram при 5xx + cron failures.

- Dedup ключи `tg:dedup:{key}` в Redis (TTL 5 минут — одна и та же ошибка не спам'ит)
- Excluded paths: `/api/v1/auth/me`, `/health`, `/metrics`, `/favicon`
- Конфиг: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- Если token отсутствует → no-op (dev)

## HeartbeatService + `runCronHandler`

См. [[cron-jobs]].

### `runCronHandler(name, logger, tg, handler)`
Wrapper для каждого `@Cron(...)` метода:
1. **Kill switch:** `CRON_<NAME>_ENABLED=false` → skip (no redeploy)
2. **Catch + log** unexpected exceptions
3. **Telegram alert** с dedup per cron name
4. **Duration log**
5. **Heartbeat:** `HeartbeatService.recordSuccess(name)` → Redis `cron:heartbeat:{name}`

### HeartbeatService
- `recordSuccess(name)` — SET `cron:heartbeat:{name} = Date.now()`, SADD `cron:heartbeat:names`
- `checkMissed()` — для каждого known cron сравнивает age vs `CRON_EXPECTED_INTERVAL_MS + GRACE_MS (1h)` → alert `CRON_MISSED`

## AES-GCM transformer (`common/crypto/aes-gcm-transformer.ts`)

TypeORM `ColumnTransformer` для at-rest шифрования. Key = `DATA_ENCRYPTION_KEY` env (base64, 32 bytes).

Применяется на:
- `User.gmailRefreshToken` (CASA Tier 2)
- Любые long-lived secrets в БД

## Antivirus (`common/antivirus/`)

`AntivirusService` — wrapper над ClamAV (если настроен). Сканирует uploaded files (receipts, screenshots) перед persist в DO Spaces.

## PII helpers (`common/utils/pii.ts`)

- `maskEmail(email)` — `j***@example.com` для логов

## Cache-Control interceptor

`@Public()` / `@PrivateCache(...)` — управление response cache headers.

## Связанные

- [[architecture]] — глобальная picture
- [[effective-access]] — backend для `PlanGuard`
- [[outbox]], [[reconciliation]] — heavy users `runCronHandler`
- [[cron-jobs]] — полный список cron + heartbeat expectations
