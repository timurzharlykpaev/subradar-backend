---
title: Модуль AI-анализа (Analysis)
tags: [module, analysis, ai, openai, bullmq, recommendations, duplicates, overlaps]
sources:
  - src/analysis/analysis.controller.ts
  - src/analysis/analysis.service.ts
  - src/analysis/analysis.processor.ts
  - src/analysis/analysis.cron.ts
  - src/analysis/analysis.constants.ts
  - src/analysis/analysis.module.ts
  - src/analysis/market-data.service.ts
  - src/analysis/guards/plan.guard.ts
  - src/analysis/entities/analysis-job.entity.ts
  - src/analysis/entities/analysis-result.entity.ts
  - src/analysis/entities/analysis-usage.entity.ts
updated: 2026-05-22
---

# Модуль AI-анализа

Отдельный от [[ai-module]] feature-модуль для глубокого LLM-анализа подписок пользователя/команды: рекомендации (отмена, downgrade, switch), детекция дубликатов и overlap'ов в команде.

> AI-модуль ([[ai-module]]) — это gateway к OpenAI (wizard, voice, screenshot, lookup). **Analysis** — отдельный BullMQ-пайплайн для тяжёлого batch-анализа подписочного портфеля.

## Сущности

### AnalysisJob (`analysis_jobs`)

Запущенный job. Lifecycle:
```
QUEUED → COLLECTING → NORMALIZING → LOOKING_UP → ANALYZING → COMPLETED | FAILED
```

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `userId` | UUID | |
| `workspaceId` | UUID | nullable — team analysis |
| `status` | enum | См. lifecycle выше |
| `triggerType` | enum | `MANUAL` / `AUTO` / `CRON` / `SUBSCRIPTION_CHANGE` |
| `inputHash` | varchar(64) | SHA-256(subs + locale + currency + region) — дедуп |
| `stageProgress` | jsonb | `{ collect, normalize, marketLookup, aiAnalyze, store: pending\|done }` |
| `tokensUsed`, `webSearchesUsed` | int | |
| `resultId` | UUID | FK на AnalysisResult |
| `error` | text | |

### AnalysisResult (`analysis_results`)

Готовый результат, TTL 7 дней.

| Поле | Тип | Описание |
|------|-----|----------|
| `summary` | text | AI-копи на `locale` |
| `totalMonthlySavings` | decimal | Совокупная экономия |
| `currency` | varchar(3) | Валюта результата (можно конвертировать через `displayCurrency`) |
| `recommendations` | jsonb | `Recommendation[]` |
| `duplicates` | jsonb | `DuplicateGroup[]` |
| `overlaps` | jsonb | `SubscriptionOverlap[]` (только для workspace) |
| `teamSavings` | decimal | Сумма экономии team (workspace only) |
| `memberCount` | int | (workspace only) |
| `subscriptionCount` | int | Сколько подписок проанализировано |
| `modelUsed` | varchar(32) | Default `gpt-4o` |
| `tokensUsed` | int | |
| `expiresAt` | timestamp | |

`Recommendation.type`: `CANCEL` / `DOWNGRADE` / `SWITCH_PLAN` / `SWITCH_PROVIDER` / `BUNDLE` / `LOW_USAGE`.

### AnalysisUsage (`analysis_usage`)

Недельный счётчик (Mon-Mon UTC).

| Поле | Тип | Описание |
|------|-----|----------|
| UNIQUE(userId, periodStart) | | |
| `autoAnalysesUsed`, `manualAnalysesUsed`, `webSearchesUsed`, `tokensUsed` | int | |
| `lastManualAt` | timestamp | Для 24h cooldown |

При гонке concurrent INSERT перехватывает `23505 unique_violation` → re-read.

## Лимиты (`analysis.constants.ts`)

| | Pro | Team (Organization) |
|-|-----|---------------------|
| `maxAutoPerWeek` | 1 | 1 |
| `maxManualPerWeek` | 1 | 1 |
| `maxSubscriptionsPerAnalysis` | 50 | 100 |
| `maxWebSearchesPerAnalysis` | 5 | 10 |
| `maxTokensPerAnalysis` | 12000 | 16000 |
| `maxTokensPerMonth` | 50000 | 100000 |
| `manualCooldownHours` | 24 | 24 |
| `subscriptionChangeDebounceMins` | 60 | 60 |
| `resultTtlDays` | 7 | 7 |

> Внутри код использует `'pro' | 'team'` как ключ лимитов. Биллинг возвращает `'organization'` → нормализуется в `'team'`.

## API эндпоинты

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| `POST` | `/analysis/run` | JWT + `AnalysisPlanGuard` | Запуск manual анализа (10/min throttle) |
| `GET` | `/analysis/latest?displayCurrency=` | JWT + `AnalysisPlanGuard` | Последний свежий result + active job + canRunManual |
| `GET` | `/analysis/status/:jobId` | JWT + `AnalysisPlanGuard` | Прогресс job (stageProgress) |
| `GET` | `/analysis/usage` | JWT + `AnalysisPlanGuard` | Недельная статистика использования |

**Body `/analysis/run`** (всё optional): `{ locale?, currency?, region?, country? }` — overrides профиля. `country` => `region` (alias для веба).

**`displayCurrency` на `/latest`** — additive, FX-конвертит `totalMonthlySavings`, цены рекомендаций, amounts в duplicates, teamSavings (не трогает text). Старые клиенты не шлют — получают результат в исходной валюте.

## Дедупликация

- `inputHash = SHA-256(userId + workspaceId? + subs[] + locale + currency + region)`
- Если свежий result (≤ resultTtlDays) с тем же hash → возвращается cached (без AI-вызова)
- Если job с тем же hash в работе → возвращается тот же jobId
- Меняешь `locale`/`currency`/`region` → forced пересчёт

## Pipeline (AnalysisProcessor, BullMQ queue `ai-analysis`)

1. **COLLECTING** — загрузка subs (либо одного user, либо всех members workspace)
2. **NORMALIZING** — convert на monthly amount (WEEKLY×4.33, QUARTERLY/3, YEARLY/12, LIFETIME/ONE_TIME=0), FX в `currency` overrides
3. **LOOKING_UP** — market data: ищет альтернативы через `MarketDataService` (web-search budget)
4. **ANALYZING** — OpenAI prompt (`gpt-4o`, JSON mode) → recommendations + duplicates + (для workspace) overlaps
5. **STORE** — INSERT AnalysisResult, UPDATE AnalysisJob → COMPLETED

Retry: `attempts: 2`, exponential backoff 5s.
`removeOnComplete: 100`, `removeOnFail: 50` (хранится последние).

## Cron задачи

### `weeklyAnalysisTrigger` — `@Cron('0 9 * * 1')` (понедельник 9:00 UTC)
- Все active Pro/Team users → enqueue `AnalysisService.run(userId, CRON)`
- Batch 50 + 1s пауза между батчами
- Уважает дедуп — если result свежий, ничего не делает

### `weeklyDigestSend` — `@Cron('0 12 * * 1')` (понедельник 12:00 UTC)
- Для каждого Pro/Team user'а с `weeklyDigestEnabled = true` и свежим result (< 7 дней)
- Atomic claim: `UPDATE users SET weeklyDigestSentAt = NOW() WHERE weeklyDigestSentAt IS NULL OR weeklyDigestSentAt < cutoff` — single-pod win
- Отправка через [[notifications-module]] (`sendWeeklyDigest`)

### `cleanup` (analysisCleanup) — `@Cron('0 3 * * 0')` (воскресенье 3:00 UTC)
- Delete expired `analysis_results` (по `expiresAt < now`)
- Stuck-job timeout: job в работе > 1 час → `FAILED` (сохраняет original error если был)

См. [[cron-jobs]] для полного списка.

## Связанные модули

- [[ai-module]] — gateway к LLM (но не рекомендации)
- [[workspace-module]] — workspace-scoped analysis + team overlaps
- [[billing-module]] — план user'а определяет лимиты
- [[fx-module]] — конвертация result в displayCurrency
- [[notifications-module]] — weekly digest email
