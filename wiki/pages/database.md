---
title: База данных
tags: [database, typeorm, postgres, migrations, entities, redis]
sources:
  - src/data-source.ts
  - src/app.module.ts
  - src/migrations/
  - src/billing/entities/user-billing.entity.ts
  - src/billing/entities/webhook-event.entity.ts
  - src/billing/entities/billing-dead-letter.entity.ts
  - src/billing/outbox/entities/outbox-event.entity.ts
  - src/billing/trials/entities/user-trial.entity.ts
  - src/common/audit/audit-log.entity.ts
  - src/common/idempotency/idempotency-key.entity.ts
  - src/workspace/entities/workspace.entity.ts
  - src/workspace/entities/workspace-member.entity.ts
  - src/workspace/entities/invite-code.entity.ts
  - src/catalog/entities/catalog-service.entity.ts
  - src/catalog/entities/catalog-plan.entity.ts
  - src/analysis/entities/analysis-job.entity.ts
  - src/analysis/entities/analysis-result.entity.ts
  - src/analysis/entities/analysis-usage.entity.ts
  - src/reports/entities/report.entity.ts
  - src/notifications/entities/push-token.entity.ts
  - src/notifications/entities/suppressed-email.entity.ts
updated: 2026-05-22
---

# База данных

## PostgreSQL

### Подключение

- **ORM:** TypeORM
- **Провайдер:** DigitalOcean Managed PostgreSQL
- **SSL:** `{ rejectUnauthorized: false }` в production + `NODE_TLS_REJECT_UNAUTHORIZED=0`

### Раздельные базы

| Среда | База | Описание |
|-------|------|----------|
| Production | `subradar` | DO Managed |
| Development | `subradar_dev` | DO Managed (тот же кластер) |

### Конфигурация (app.module.ts)

```typescript
TypeOrmModule.forRootAsync({
  useFactory: (cfg: ConfigService) => ({
    type: 'postgres',
    url: cfg.get('DATABASE_URL'),       // или отдельные DB_HOST/DB_PORT/...
    autoLoadEntities: true,
    synchronize: false,                  // ВСЕГДА false — только миграции
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    migrationsRun: true,                 // Автозапуск при старте
    ssl: isProd ? { rejectUnauthorized: false } : undefined,
  }),
});
```

**Критично:** `synchronize: false` всегда. Ранее был `true` в dev, но отключён — миграции должны покрывать все изменения схемы.

### DataSource (CLI)

Файл `src/data-source.ts` — отдельный DataSource для CLI миграций:
```bash
npm run migration:generate -- src/migrations/DescriptiveName
npm run migration:run
npm run migration:revert
npm run migration:show
```

## Сущности

### Основные таблицы

| Таблица | Сущность | Модуль |
|---------|---------|--------|
| `users` | User | users |
| `user_billing` | UserBilling | billing |
| `user_trials` | UserTrial | billing/trials |
| `subscriptions` | Subscription | subscriptions |
| `payment_cards` | PaymentCard | payment-cards |
| `receipts` | Receipt | receipts |
| `refresh_tokens` | RefreshToken | auth |
| `reports` | Report | reports |
| `workspaces` | Workspace | workspace |
| `workspace_members` | WorkspaceMember | workspace |
| `invite_codes` | InviteCode | workspace |
| `push_tokens` | PushToken | notifications |
| `suppressed_emails` | SuppressedEmail | notifications |

### Billing infra таблицы

| Таблица | Сущность | Описание |
|---------|----------|----------|
| `webhook_events` | WebhookEvent | Idempotency для RC/LS webhooks (UNIQUE provider+eventId) |
| `billing_dead_letter` | BillingDeadLetter | InvalidTransitionError capture, resolved/replay |
| `outbox_events` | OutboxEvent | Transactional outbox (Amplitude/Telegram/FCM) |

### Cross-cutting таблицы

| Таблица | Сущность | Описание |
|---------|----------|----------|
| `audit_logs` | AuditLog | Append-only лог чувствительных операций |
| `idempotency_keys` | IdempotencyKey | Request-level idempotency (RFC 9110), TTL 24h |

### AI/Analysis таблицы

| Таблица | Сущность | Модуль |
|---------|---------|--------|
| `analysis_jobs` | AnalysisJob | analysis |
| `analysis_results` | AnalysisResult | analysis |
| `analysis_usage` | AnalysisUsage | analysis |
| `service_catalog` | ServiceCatalog (legacy) | analysis |

### FX / Catalog таблицы

| Таблица | Сущность | Модуль |
|---------|---------|--------|
| `fx_rate_snapshots` | FxRateSnapshot | fx |
| `catalog_services` | CatalogService | catalog |
| `catalog_plans` | CatalogPlan | catalog |

### Gmail (если применимо)

| Таблица | Описание |
|---------|----------|
| `known_billing_senders` | Список known no-reply / billing senders для Gmail filter (если выделен в отдельную таблицу) |

### Связи

```
User 1—N Subscription (CASCADE delete)
User 1—N PaymentCard (CASCADE delete)
User 1—1 UserBilling (CASCADE delete) — Phase 2 split off
User 1—1 UserTrial (CASCADE, UNIQUE(user_id))
User 1—N WorkspaceMember
Subscription N—1 PaymentCard (SET NULL on delete)
Subscription N—1 CatalogService (nullable FK)
Subscription N—1 CatalogPlan (nullable FK)
CatalogService 1—N CatalogPlan
Workspace 1—N WorkspaceMember
Workspace 1—N InviteCode
Report N—1 User (CASCADE) + nullable workspaceId
WebhookEvent.userId → users SET NULL (preserve audit trail)
```

## Миграции

### Процесс создания миграции

1. Изменить entity (добавить поле/таблицу)
2. Сгенерировать: `npm run migration:generate -- src/migrations/DescriptiveName`
3. Проверить SQL в сгенерированном файле
4. Тест на dev: push в `dev` → auto-deploy → `migrationsRun: true`
5. Push в `main` → prod deployment

### Список миграций (хронологический)

| Timestamp | Описание |
|-----------|---------|
| 1740873600000 | InitialSchema |
| 1742500200000 | AddUserReminderAndMissingCols |
| 1772909030797 | AddUserFields |
| 1772909100000 | AddNextPaymentDate |
| 1772910000000 | AddEmailNotifications |
| 1772970000000 | FixWorkspaceUuidColumns |
| 1773360000000 | AddCancelAtPeriodEnd |
| 1774500000000 | AddSubscriptionIndexes |
| 1774600000000 | AddNewSubscriptionCategories |
| 1774700000000 | AddReportErrorColumn |
| 1775200000000 | CreateAnalysisTables |
| 1775200100000 | AddWeeklyDigestToUser |
| 1775200200000 | SeedServiceCatalog |
| 1775300000000 | CreateInviteCodes |
| 1775400000000 | ExtendInviteCodeLength |
| 1775600000000 | AddDowngradedAtToUser |
| 1775700000000 | AddBillingPeriodToUser |
| 1775800000000 | FixReminderDefaults |
| 1776067408000 | AddGracePeriodAndExpired |
| 1776153808000 | AddBillingIssueAt |
| 1776240000000 | AddUserRegionAndDisplayCurrency |
| 1776240001000 | AddSubscriptionCurrencyAndCatalogLinks |
| 1776240002000 | CreateFxAndCatalogTables |

### Правила миграций

- **НИКОГДА** не редактировать существующие миграции
- PostgreSQL не поддерживает удаление значений enum → только `ADD VALUE IF NOT EXISTS`
- NOT NULL колонки на заполненных таблицах: nullable → backfill → NOT NULL (три миграции)
- Миграции должны работать на обеих базах (prod и dev)

## Redis

| Использование | Ключи | TTL |
|--------------|-------|-----|
| FX курсы | `fx:latest` | 6 часов |
| FX lock | `fx:refresh:lock` | 30 сек |
| Аналитика | `analytics:summary:{userId}:...` | 5 мин |
| AI lookup | `ai:lookup:{query}:...` | 24 часа |
| AI lookup lock | `ai:lookup:lock:{slug}` | 60 сек |
| Analysis debounce | `analysis:sub-change-debounce:{userId}` | настраиваемый |
| OTP | `otp:{email}` | 15 мин |
| Auth lockout | `auth:lockout:{email}` | 1 час |
| OTP lockout | `auth:lockout:otp:{email}` | 1 час |

Bull queues:
- `notifications` — push/email рассылка
- `analysis` — AI-анализ подписок
- `catalog-refresh` — обновление цен каталога

Prefix: `bull:{NODE_ENV}` (изоляция dev/prod на одном Redis).

Подробнее: [[architecture]], [[deploy]], [[fx-module]]
