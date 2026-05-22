---
title: Модуль биллинга (Billing)
tags: [module, billing, plans, revenuecat, lemon-squeezy, trial, grace-period, workspace, state-machine]
sources:
  - src/billing/billing.service.ts
  - src/billing/billing.controller.ts
  - src/billing/plans.config.ts
  - src/billing/grace-period.cron.ts
  - src/billing/state-machine/transitions.ts
  - src/billing/state-machine/reconcile.ts
  - src/billing/state-machine/types.ts
  - src/billing/user-billing.repository.ts
  - src/billing/entities/user-billing.entity.ts
  - src/billing/entities/webhook-event.entity.ts
  - src/billing/entities/billing-dead-letter.entity.ts
  - src/billing/effective-access/effective-access.service.ts
  - src/billing/trials/trials.service.ts
  - src/billing/reconciliation/reconciliation.service.ts
  - src/billing/outbox/outbox.service.ts
  - src/billing/revenuecat/rc-client.service.ts
  - src/billing/lemon-squeezy/event-mapper.ts
  - src/workspace/entities/workspace.entity.ts
  - src/workspace/entities/workspace-member.entity.ts
updated: 2026-05-22
---

# Модуль биллинга

## Субмодули

| Sub | Что делает | Страница |
|-----|-----------|----------|
| `trials/` | One-trial-per-user, UNIQUE(user_id), transactional `activate()` | [[trials]] |
| `effective-access/` | Резолвер плана + cache + banner priority | [[effective-access]] |
| `reconciliation/` | Hourly post-webhook state sync с RC | [[reconciliation]] |
| `outbox/` | Transactional outbox для Amplitude/Telegram/FCM | [[outbox]] |
| `state-machine/` | Pure-functional transitions, reconcile, infer-event | (см. `src/billing/state-machine/`) |
| `revenuecat/` | RC REST client + event mapper | — |
| `lemon-squeezy/` | LS HMAC verify + event mapper | — |
| `health/` | `GET /billing/health` operator dashboard (outbox stats, DLQ count) | — |

## Тарифные планы

### Лимиты (plans.config.ts)

| | Free | Pro | Organization |
|-|------|-----|-------------|
| Подписки | 3 | unlimited | unlimited |
| AI запросов/мес | 5 | 200 | 1000 |
| Invite | нет | да | да |
| Создание org | нет | нет | да |
| Analysis | нет | да | да |
| Max analysis subs | — | 50 | 100 |
| Web searches/analysis | 0 | 5 | 10 |

### Цены

| План | Месяц | Год |
|------|-------|-----|
| Free | $0 | $0 |
| Pro | $2.99 | $24.99 |
| Organization | $9.99 | $99.99 |

## Биллинг-провайдеры

### RevenueCat (мобилка — iOS IAP)

Основной биллинг для мобильного приложения.

**Webhook:** `POST /billing/revenuecat-webhook`
- Авторизация: `Authorization: Bearer {REVENUECAT_WEBHOOK_SECRET}`
- Timing-safe сравнение секрета

**Обрабатываемые события:**

| Событие | Действие |
|---------|---------|
| `INITIAL_PURCHASE` | Активация плана, сброс cancellation flags |
| `RENEWAL` | Продление, сброс cancellation flags |
| `PRODUCT_CHANGE` | Смена плана |
| `CANCELLATION` | Пометка `cancelAtPeriodEnd = true`, сохранение `currentPeriodEnd` |
| `EXPIRATION` | Даунгрейд до free, grace period 7 дней, каскад на team members |
| `UNCANCELLATION` | Восстановление подписки, сброс grace |
| `BILLING_ISSUE` | Пометка `billingIssueAt` (Apple retry period) |

**Product ID → Plan маппинг:**

```
io.subradar.mobile.pro.monthly    → pro
io.subradar.mobile.pro.yearly     → pro
io.subradar.mobile.team.monthly   → organization
io.subradar.mobile.team.yearly    → organization
```

**Sync endpoint:** `POST /billing/sync-revenuecat { productId }`
- Клиент вызывает после покупки для немедленного обновления плана
- Серверная верификация через RevenueCat REST API (`REVENUECAT_API_KEY`)
- Fallback: если RC API недоступен — доверяет клиенту

### Lemon Squeezy (веб)

**Webhook:** `POST /billing/webhook`
- Верификация: HMAC-SHA256 через `x-signature` header
- Raw body захватывается через bodyParser middleware

**Обрабатываемые события:**
- `subscription_created` / `subscription_updated` → активация плана
- `subscription_cancelled` → даунгрейд до free + каскад на invitee

**Checkout:** `POST /billing/checkout { variantId?, planId?, billing? }`
- Создаёт checkout URL через Lemon Squeezy API
- Variant ID резолвится из planId + billing period

## Effective Access (Single Source of Truth)

Резолвер живёт в **`EffectiveAccessResolver`** ([[effective-access]]) — единственная точка где принимается решение «какой план у юзера прямо сейчас». In-process TTL cache 60s, invalidate по каждому applyTransition.

Приоритет:
1. **Team Owner** с active org plan → `organization`
2. **Team Member** (owner платит, owner active) → `organization`
3. **Собственная RC подписка** → `pro` / `organization`
4. **Активный trial** (`UserTrial.endsAt > now`) → `pro`
5. **Grace period** (`gracePeriodEnd > now`) → `pro` (source: `grace_team` или `grace_pro`)
6. **Всё остальное** → `free`

Полная shape `BillingMeResponse` (с `limits.canCreateOrg/canInvite`, banner, refundedAt) — см. [[effective-access]].

## Trial

- 7 дней Pro / Organization, 1 per user (DB UNIQUE)
- Каноничное хранилище: `user_trials` (см. [[trials]])
- Legacy `user.trialUsed / trialStartDate / trialEndDate` — остаются один релиз как rollback net, читать через [[effective-access]]
- `POST /billing/trial` — legacy endpoint, сохранён для обратной совместимости
- Sources: `revenuecat_intro` (RC intro offer webhook), `backend` (legacy), `lemon_squeezy`

## Grace Period

При EXPIRATION RevenueCat:
1. Пользователь получает `gracePeriodEnd = now + 7 дней`
2. Если это team owner — каскад на всех team members:
   - `workspace.expiredAt = now`
   - Все члены получают `gracePeriodEnd = now + 7 дней`, `gracePeriodReason = 'team_expired'`

Cron `GracePeriodCron`:
- `resetExpiredGrace` — `@Cron('5 0 * * *')` — сброс через state machine `GRACE_EXPIRED` (см. [[cron-jobs]])
- `cleanupAbandonedWorkspaces` — `@Cron('0 9 * * *')` — удаление workspaces с `expiredAt > 30 days`

## State machine

Все мутации `user_billing` идут через `UserBillingRepository.applyTransition(userId, event, { actor })`:
1. Read snapshot (FOR UPDATE)
2. `transition(snapshot, event)` — pure function (`src/billing/state-machine/transitions.ts`)
3. Если `InvalidTransitionError` → INSERT `billing_dead_letter` (queryable, replayable), telegram alert, return `{ applied: false, reason: 'invalid_transition' }`
4. Если `next === current` → return `{ applied: false, reason: 'idempotent_noop' }`
5. UPDATE `user_billing`, audit, outbox events — всё в одной tx
6. `EffectiveAccessResolver.invalidate(userId)` — bust cache

**Events:** RC_INITIAL_PURCHASE, RC_RENEWAL, RC_PRODUCT_CHANGE, RC_CANCELLATION, RC_UNCANCELLATION, RC_EXPIRATION, RC_BILLING_ISSUE, **RC_REFUND** (entitlement reversed immediately, not at period end), TEAM_OWNER_EXPIRED, TEAM_MEMBER_REMOVED, GRACE_EXPIRED, TRIAL_EXPIRED, ADMIN_GRANT_PRO, LS_*.

**States:** `free` / `active` / `cancel_at_period_end` / `billing_issue` / `grace_pro` / `grace_team`.

## Webhook idempotency

`webhook_events` (UNIQUE(`provider`, `eventId`)) — INSERT перед обработкой, duplicate-key error → 200 OK без повторной обработки. Поле `error` сохраняет stack для retry через [[reconciliation]].

## Dead Letter Queue

`billing_dead_letter` — capture каждой `InvalidTransitionError` с `userId, fromState, eventType, actor, eventPayload, error, resolved, resolutionNotes`. Telegram alert на insert; resolved-flag для operator workflow.

## Pro Invite (For You + One)

- Pro пользователь может пригласить 1 человека:
  - `POST /billing/invite { email }` → invitee получает Pro
  - `DELETE /billing/invite` → invitee теряет Pro (если нет собственной подписки)
- `user.proInviteeEmail` хранит email приглашённого

## AI запросы

`consumeAiRequest(userId)`:
1. Считывает effective plan через `getEffectiveAccess()`
2. Проверяет месячный лимит: `user.aiRequestsUsed` vs `planConfig.aiRequestsLimit`
3. При автосбросе в новый месяц обнуляет счётчик
4. Бросает `ForbiddenException` при превышении лимита

## GET /billing/me

Возвращает полную информацию о биллинге:
```json
{
  "plan": "pro",
  "source": "own",
  "isTeamOwner": false,
  "isTeamMember": false,
  "hasOwnPro": true,
  "graceUntil": null,
  "graceDaysLeft": null,
  "hasBillingIssue": false,
  "billingPeriod": "monthly",
  "status": "active",
  "currentPeriodEnd": null,
  "cancelAtPeriodEnd": false,
  "trialUsed": true,
  "trialDaysLeft": null,
  "subscriptionCount": 12,
  "subscriptionLimit": null,
  "aiRequestsUsed": 5,
  "aiRequestsLimit": 200,
  "proInviteeEmail": null,
  "downgradedAt": null
}
```

## Cancel

`POST /billing/cancel`:
1. Если trial активен (без RC) → даунгрейд до free
2. Если RC подписка → `cancelAtPeriodEnd = true` (RC пришлёт EXPIRATION когда период закончится)
3. Если не-RC подписка → немедленный даунгрейд до free

Подробнее: [[auth-module]], [[users-module]], [[notifications-module]], [[trials]], [[effective-access]], [[reconciliation]], [[outbox]], [[workspace-module]]
