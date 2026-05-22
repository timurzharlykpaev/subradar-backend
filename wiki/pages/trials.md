---
title: Trials (one-trial-per-user)
tags: [billing, trial, submodule, state-machine, revenuecat]
sources:
  - src/billing/trials/trials.service.ts
  - src/billing/trials/trials.module.ts
  - src/billing/trials/entities/user-trial.entity.ts
updated: 2026-05-22
---

# Trials

Sub-модуль [[billing-module]] — каноничное хранилище и активация триалов.

Заменяет legacy `users.trialUsed / trialStartDate / trialEndDate` (поля остаются один релиз как rollback net и будут удалены в follow-up миграции).

## Сущность UserTrial (`user_trials`)

UNIQUE(`user_id`) — DB-level enforcement правила one-trial-per-user.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `userId` | UUID UNIQUE | FK → users (CASCADE) |
| `source` | enum | `revenuecat_intro` / `backend` / `lemon_squeezy` |
| `plan` | enum | `pro` / `organization` |
| `startedAt` | timestamptz | |
| `endsAt` | timestamptz (indexed) | `startedAt + 7 days` |
| `consumed` | boolean | `false` пока receipt pending validation; `true` для finalised |
| `originalTransactionId` | text | RC/Apple original tx id (NULL для backend) |
| `createdAt`, `updatedAt` | timestamptz | |

Enum типы: `trial_source_enum`, `trial_plan_enum`.

## TrialsService.activate()

```ts
activate(userId, source: TrialSource, plan: TrialPlan, originalTxId?): Promise<UserTrial>
```

**Транзакция** (`ds.transaction`):

1. **Pessimistic write lock** на `(user_trial.userId)` — даже на потенциально missing row (двое параллельных активаций блокируют друг друга до commit/rollback)
2. Если existing → `ConflictException('Trial already used')`
3. Find user; если missing → BadRequest
4. Если `source === 'backend' && user.plan !== 'free'` → BadRequest (нельзя downgrade-в-trial платящего пользователя; RC intro offers bypass — driven by store state)
5. INSERT UserTrial (`startedAt = now`, `endsAt = now + 7d`, `consumed = true`)
6. `AuditService.log({ action: 'billing.trial_activated', ... })`
7. `OutboxService.enqueue('amplitude.track', { event: 'billing.trial_started' }, m)` — **в той же транзакции** (если outer tx rollback → outbox row пропадает с ней → Amplitude не услышит про несуществующий trial)

**Инварианты:**
- One trial per user — UNIQUE(user_id) + pessimistic lock
- Backend-source только для free-юзеров
- Audit + outbox внутри той же транзакции — atomic side-effects

## TrialsService.status()

Read-only: `findOne({ userId })`. Использует [[effective-access]] для определения активности (`endsAt > now`).

## Когда вызывается

- **Backend-trial** (legacy `POST /billing/trial` — deprecated, но сохранён для старых клиентов)
- **RC intro offer** — webhook handler RC_INITIAL_PURCHASE с intro period → `activate(userId, 'revenuecat_intro', plan, txId)`
- **Lemon Squeezy trial** (для веба) — webhook → `activate(userId, 'lemon_squeezy', plan)`

## Связанные

- [[billing-module]] — overarching
- [[effective-access]] — резолвит `trialActive` для `/billing/me`
- [[outbox]] — transactional event delivery
- [[common-cross-cutting]] → audit
