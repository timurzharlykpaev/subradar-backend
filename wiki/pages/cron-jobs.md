---
title: Cron / BullMQ задачи (централизованный список)
tags: [cron, bullmq, heartbeat, schedule, kill-switch]
sources:
  - src/analysis/analysis.cron.ts
  - src/billing/grace-period.cron.ts
  - src/billing/reconciliation/reconciliation.cron.ts
  - src/billing/outbox/outbox.worker.ts
  - src/catalog/catalog-refresh.cron.ts
  - src/fx/fx-refresh.cron.ts
  - src/notifications/notifications.service.ts
  - src/reminders/reminders.service.ts
  - src/reminders/monthly-report.service.ts
  - src/subscriptions/trial-checker.cron.ts
  - src/common/cron/run-cron-handler.ts
  - src/common/heartbeat.service.ts
  - src/common/health-watch.cron.ts
  - src/common/heartbeat.cron.ts
updated: 2026-05-22
---

# Cron / BullMQ — централизованный список

Все периодические задачи backend'а. Каждая обёрнута в `runCronHandler(name, logger, tg, body)` который:
1. Уважает kill switch `CRON_<NAME>_ENABLED=false`
2. Ловит исключения + Telegram alert (deduped)
3. Логирует duration
4. Записывает heartbeat в Redis для miss-detection

См. [[common-cross-cutting]] → cron-handler / heartbeat.

## Schedule (NestJS `@nestjs/schedule`)

| Cron name | Schedule | Описание | Источник |
|-----------|----------|----------|----------|
| `sendDailyReminders` | `0 9 * * *` | Daily reminder push + email подписок с `nextPaymentDate` в `reminderDaysBefore` | `reminders.service.ts` |
| `sendTrialExpiryReminders` | `0 10 * * *` | Push за 1/4 дня до trial expiry | `reminders.service.ts` |
| `sendProExpirationReminders` | `0 10 * * *` | Push за 7/3/1/0 дней до Pro expiration; email за 7 | `reminders.service.ts` |
| `sendWinBackPush` | `0 14 * * *` | Push неактивным 7+ дней пользователям с upcoming renewals | `reminders.service.ts` |
| `expireTrials` | `0 * * * *` | Hourly — даунгрейд истёкших trials в free | `reminders.service.ts` |
| `resetExpiredGrace` | `5 0 * * *` | Сброс grace period → free через state machine (`GRACE_EXPIRED`) | `billing/grace-period.cron.ts` |
| `cleanupAbandonedWorkspaces` | `0 9 * * *` | Удаление workspaces с `expiredAt > 30 days` | `billing/grace-period.cron.ts` |
| `sendWeeklyPushDigest` | `0 11 * * 0` | Sunday — weekly push с total spend + count renewals | `notifications.service.ts` (или reminders) |
| `weeklyAnalysisTrigger` | `0 9 * * 1` | Mon — kick off AI analysis для всех Pro/Team | `analysis/analysis.cron.ts` |
| `weeklyDigestSend` | `0 12 * * 1` | Mon — email digest с analysis результатами (atomic claim) | `analysis/analysis.cron.ts` |
| `analysisCleanup` | `0 3 * * 0` | Sun — delete expired analysis_results + fail stuck jobs | `analysis/analysis.cron.ts` |
| `catalogRefreshTopServices` | `0 4 * * 1` | Mon — enqueue refresh топ-50 services x N regions | `catalog/catalog-refresh.cron.ts` |
| `sendMonthlyReports` | (monthly) | Monthly PDF reports для Pro users | `reminders/monthly-report.service.ts` |
| `fxRefreshDaily` | (daily) | FX rates pull + persist в `fx_rate_snapshots` | `fx/fx-refresh.cron.ts` |
| `reconciliation` | `0 * * * *` | Hourly RC↔local state sync (gated `BILLING_RECONCILIATION_ENABLED`) | `billing/reconciliation/reconciliation.cron.ts` |
| `heartbeatMonitor` | (hourly) | Check missed heartbeats → CRON_MISSED telegram alerts | `common/heartbeat.cron.ts` |
| (recompute nextPaymentDate) | `0 0 * * *` | Daily пересчёт `nextPaymentDate` для активных подписок | `subscriptions/trial-checker.cron.ts` или `subscriptions.service` |

## BullMQ queues (Redis-backed, не cron-driven)

| Queue | Назначение | Processor |
|-------|-----------|-----------|
| `notifications` | Push / email рассылка | `notifications.processor.ts` |
| `ai-analysis` | AI deep-analysis pipeline | `analysis/analysis.processor.ts` |
| `reports` | PDF/CSV generation | `reports/reports.processor.ts` |
| `catalog-refresh` | Refresh регион/цены | `catalog/catalog-refresh.processor.ts` |

**Prefix:** `bull:{NODE_ENV}` — изоляция dev/prod на одном Redis.

## OutboxWorker

`@Cron(EVERY_10_SECONDS)` — драит `outbox_events` (см. [[outbox]]).
- Не имеет heartbeat (запускается слишком часто; observability через `stats()`)

## Heartbeat expectations (для `heartbeatMonitor`)

`CRON_EXPECTED_INTERVAL_MS` (из `heartbeat.service.ts`):

```
sendDailyReminders         24h
sendTrialExpiryReminders   24h
sendProExpirationReminders 24h
sendWinBackPush            24h
expireTrials               1h
resetExpiredGrace          24h
cleanupAbandonedWorkspaces 24h
sendWeeklyPushDigest       7d
weeklyAnalysisTrigger      7d
weeklyDigestSend           7d
catalogRefreshTopServices  7d
analysisCleanup            7d
sendMonthlyReports         31d
fxRefreshDaily             24h
reconciliation             1h
heartbeatMonitor           1h
```

Grace: +1h. Alert если age > expected + grace. Dedup в Telegram через `cron-missed:{name}`.

## Kill switches

Любой cron можно выключить через env:
```
CRON_RECONCILIATION_ENABLED=false
CRON_WEEKLY_DIGEST_SEND_ENABLED=false
```

Form: snake_case OR camelCase upper — оба работают. Default: enabled.

## Связанные

- [[architecture]] — глобальный contex (BullModule, ScheduleModule)
- [[common-cross-cutting]] → run-cron-handler, heartbeat
- [[outbox]] — отдельный pattern для transactional side-effects
- [[reconciliation]], [[analysis-module]], [[catalog-module]], [[notifications-module]] — heavy users
