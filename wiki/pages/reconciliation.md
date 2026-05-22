---
title: Reconciliation (post-webhook state sync)
tags: [billing, reconciliation, cron, revenuecat, state-machine, submodule]
sources:
  - src/billing/reconciliation/reconciliation.service.ts
  - src/billing/reconciliation/reconciliation.cron.ts
  - src/billing/reconciliation/reconciliation.module.ts
updated: 2026-05-22
---

# Reconciliation

Sub-модуль [[billing-module]] — hourly cron, который сверяет локальный billing-state с RC source of truth и фиксирует drift (потерянные / failed webhooks, неконсистентные state'ы).

## Зачем

Webhook'и теряются:
- RC sends EXPIRATION → network drop → не записано → user остался на `active` с истёкшим `currentPeriodEnd`
- Webhook errored (transient) → user полу-применён, нужен replay
- Apple retry period: RC шлёт EXPIRATION потом RENEWAL → race с grace, нужен пересчёт
- Race с RC `subscriptions[productId].unsubscribe_detected_at` → cancellation intent потерян

Reconciliation крутится hourly и чинит drift автоматически.

## Feature flags

| Env | Эффект |
|-----|--------|
| `BILLING_RECONCILIATION_DRY_RUN=true` | Считает drift, логирует, **не пишет** (ни UPDATE, ни audit, ни outbox) |
| `BILLING_RECONCILIATION_ENABLED=true` | Real writes |
| (оба unset) | No-op, лог `Reconciliation disabled`, return |

Safe rollout: сперва `DRY_RUN`, потом `ENABLED`.

## Cron schedule

`@Cron('0 * * * *')` — hourly on the hour. Внутри: `runCronHandler('reconciliation', ...)` — heartbeat, kill switch, telegram alerts (см. [[common-cross-cutting]] → cron).

## ReconciliationService.findSuspicious(limit)

SQL:

```sql
SELECT u.* FROM users u
JOIN user_billing b ON b."userId" = u.id
WHERE b."billingSource" = 'revenuecat'
  AND (
    -- (a) Period end в прошлом + active-ish status
    (b."currentPeriodEnd" < now() - interval '10 minutes'
     AND b."billingStatus" NOT IN ('grace_pro','grace_team','free'))

    -- (b) Stuck в grace но RC может уже flipped в active (late RENEWAL)
    OR (b."billingStatus" IN ('grace_pro','grace_team')
        AND b."gracePeriodEnd" > now())

    -- (c) Webhook errored в последние 24h
    OR u.id IN (
      SELECT DISTINCT user_id FROM webhook_events
      WHERE provider = 'revenuecat'
        AND processed_at > now() - interval '24 hours'
        AND error IS NOT NULL
    )
  )
ORDER BY b."currentPeriodEnd" ASC NULLS LAST
LIMIT $1
```

Default `limit = 200` за тик.

## reconcileOne(user, dryRun)

1. `rc.getSubscriber(user.id)` — pull authoritative snapshot
2. `current = snapshotFromUser(user)` — map User+UserBilling → `UserBillingSnapshot`
3. `next = reconcile(current, rcSub)` — state-machine pure function
4. Если `current === next` (JSON equal) → no-op, return false
5. `inferEventFromRcSnapshot(rcSub, current)` → `BillingEvent | null`
6. Если event нет → log warn + telegram alert (`[unmapped]`), manual review нужен
7. `userBilling.applyTransition(userId, event, { actor: 'reconcile' })` — атомарно: UPDATE user_billing + audit + invalidate EffectiveAccess cache
8. Если `result.applied === false` → counter не инкрементируется (invalid_transition попал в DLQ, либо idempotent_noop)
9. На success → outbox `amplitude.track 'billing.reconciliation_mismatch'` + `telegram.alert`

### Почему через applyTransition а не raw UPDATE

После Phase 2 биллинг-поля живут в `user_billing` (не `users`). Прямой `users.update()` либо no-op либо drift'ит две таблицы. Плюс bypass'ом `applyTransition` мы не инвалидируем EffectiveAccess TTL-cache → user продолжает видеть старый plan 60s.

## Rate limit

300ms sleep между RC API calls — RC cap ~10rps per key. 200 candidates ≈ 60s wall clock.

## Error handling

- RC transient 5xx/timeout → `logger.warn` (не error) → попадает в счётчик `failed`
- Раньше каждый fail слал Telegram alert → 200+ alerts на single RC outage. Сейчас один summary в конце `Reconciliation: X changed, Y failed`

## Связанные

- [[billing-module]] — overarching
- [[effective-access]] — cache invalidated по успешному apply
- [[outbox]] — telegram + amplitude events
- [[common-cross-cutting]] → cron-handler, DeadLetter
- State machine: `src/billing/state-machine/reconcile.ts`, `infer-rc-event.ts`, `transitions.ts`
