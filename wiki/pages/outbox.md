---
title: Transactional Outbox
tags: [billing, outbox, transactional, amplitude, telegram, fcm, submodule]
sources:
  - src/billing/outbox/outbox.service.ts
  - src/billing/outbox/outbox.worker.ts
  - src/billing/outbox/outbox.module.ts
  - src/billing/outbox/entities/outbox-event.entity.ts
  - src/billing/outbox/handlers/amplitude.handler.ts
  - src/billing/outbox/handlers/telegram.handler.ts
  - src/billing/outbox/handlers/fcm.handler.ts
updated: 2026-05-22
---

# Transactional Outbox

Sub-модуль [[billing-module]] — паттерн который гарантирует, что side-effects (Amplitude tracking, Telegram alerts, FCM push) **не теряются** при сбое downstream-сервиса, и не «телеграфятся призраками» если business-транзакция rollback'нулась.

## Зачем

Без outbox два проблемных сценария:

**A) Lost event.** Состояние закоммитили в DB → пытаемся вызвать Amplitude HTTP → Amplitude DOWN → событие потеряно навсегда.

**B) Phantom event.** Шлём событие в Amplitude → DB транзакция rollback'нулась (constraint error) → факта в БД нет, но Amplitude уже зафиксировал «trial_started».

Outbox решает оба: **запись в БД и outbox row живут в одной транзакции**. Воркер на интервале вытаскивает pending rows и отправляет с retry — независимо от downstream uptime.

## Сущность OutboxEvent (`outbox_events`)

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `type` | varchar(64) | `'amplitude.track'` / `'telegram.alert'` / `'fcm.push'` |
| `payload` | jsonb | type-specific |
| `status` | enum | `pending` / `processing` / `done` / `failed` (`idx_outbox_pending_status`) |
| `attempts` | int | 0..MAX_ATTEMPTS |
| `lastError` | text | первые 2000 chars |
| `nextAttemptAt` | timestamptz | when retry due |
| `createdAt`, `processedAt` | timestamptz | |

## OutboxService API

### `enqueue(type, payload, manager?)`
INSERT pending row. **Важно:** передавай `manager: EntityManager` для участия в caller-tx:

```ts
await this.ds.transaction(async (m) => {
  // ... business mutation ...
  await this.outbox.enqueue('amplitude.track', { ... }, m);
});
```

Если outer tx rolls back → outbox row тоже не commit'нется → событие никогда не было.

### `claimBatch(limit)`
Атомарно flips `status = 'processing'` и возвращает batch:

```sql
UPDATE outbox_events
SET status = 'processing'
WHERE id IN (
  SELECT id FROM outbox_events
  WHERE status = 'pending' AND next_attempt_at <= now()
  ORDER BY next_attempt_at ASC
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
RETURNING *
```

`FOR UPDATE SKIP LOCKED` — multi-pod-safe. Каждый воркер берёт свою порцию.

### `markDone(id)` / `markFailed(id, error, attempts, nextAttemptAt)`
- `nextAttemptAt = null` → status `'failed'` (выработали retry budget)
- иначе → status `'pending'` (retry)

### `stats()`
`{ pending, failed, done24h }` — для observability (Billing Health dashboard).

## OutboxWorker (cron-based)

`@Cron(EVERY_10_SECONDS)` — каждые 10s драит queue.

- BATCH_SIZE = 50
- `Promise.allSettled` — fail в одном event не блокирует остальных
- Exponential backoff: `delay = 2^attempts` seconds, clamp `MAX_BACKOFF_SECONDS = 3600` (1h)
  - 1→2s, 2→4s, …, 11→3600s (capped)
- MAX_ATTEMPTS = 10 → потом `'failed'` → alert

## Handlers

| Type | Handler | Endpoint |
|------|---------|----------|
| `amplitude.track` | `AmplitudeHandler` | Amplitude HTTP API (events POST) |
| `telegram.alert` | `TelegramHandler` | Telegram Bot API (sendMessage) с dedup |
| `fcm.push` | `FcmHandler` | Firebase Admin push notification |

Unknown type → throw → fail immediately (нет retry смысла, switch exhaustive ⇒ TS флагает новые types).

## Кто использует

- [[trials]] — `activate()` → `amplitude.track 'billing.trial_started'` (в той же tx)
- [[reconciliation]] — `amplitude.track 'billing.reconciliation_mismatch'` + `telegram.alert`
- [[workspace-module]] — `workspace.created`, `member_invited`, `ownership_transferred`, и т.п.
- `BillingService.applyTransition` — `amplitude.track` для каждого транзишн (PURCHASE, RENEWAL, CANCEL, EXPIRATION)
- Notifications: критичные FCM могут идти через outbox для at-least-once delivery

## Связанные

- [[billing-module]] — overarching
- [[reconciliation]] — heavy user
- [[common-cross-cutting]] → telegram-alert (sync path для cron failures)
