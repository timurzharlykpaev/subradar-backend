---
title: EffectiveAccess резолвер
tags: [billing, effective-access, plan-resolution, cache, banner, submodule]
sources:
  - src/billing/effective-access/effective-access.service.ts
  - src/billing/effective-access/effective-access.module.ts
  - src/billing/effective-access/billing-me.types.ts
  - src/billing/effective-access/banner-priority.ts
updated: 2026-05-22
---

# EffectiveAccess

Sub-модуль [[billing-module]] — единственный авторитет принимающий решение **«какой доступ у юзера прямо сейчас»**. Возвращает canonical `BillingMeResponse` (consumed `GET /billing/me`).

> Callers (controllers, guards, features) **обязаны** ходить через resolver, а не читать `User`-флаги напрямую. Precedence-правила живут ровно в одном месте.

## Источники истины

Загружаются параллельно:
1. `User` (id, plan, billingSource, billingPeriod, …)
2. `UserTrial` (см. [[trials]])
3. `Workspace` где `ownerId = userId` (owned)
4. `WorkspaceMember` (ACTIVE) — с eager-loaded workspace.ownerId
5. Активный team-owner billing snapshot (если есть membership)
6. Count subs (ACTIVE | TRIAL) для `subsLimitReached`

## Precedence (приоритет)

```
1. Team Owner с active organization plan → 'organization'
2. Team Member (owner платит, owner active)  → 'organization'
3. Собственная RC подписка active            → 'pro' / 'organization'
4. Активный trial (UserTrial.endsAt > now)   → 'pro'
5. Grace period (gracePeriodEnd > now)       → 'pro' (source: grace_team / grace_pro)
6. Всё остальное                             → 'free'
```

## BillingMeResponse shape

```typescript
{
  plan: 'free' | 'pro' | 'organization',
  effective: {
    plan,
    source: 'own' | 'team' | 'grace_team' | 'grace_pro' | 'trial' | 'free',
    graceUntil?: Date,
    graceDaysLeft?: number,
    workspaceId?: string,
    workspaceExpiringAt?: Date,
  },
  isTeamOwner: boolean,
  isTeamMember: boolean,
  hasOwnPro: boolean,
  hasBillingIssue: boolean,
  billingPeriod: 'monthly' | 'yearly' | null,
  status: BillingState,
  currentPeriodEnd: Date | null,
  cancelAtPeriodEnd: boolean,
  trialUsed: boolean,
  trialDaysLeft: number | null,
  subscriptionCount: number,
  subscriptionLimit: number | null,
  aiRequestsUsed: number,
  aiRequestsLimit: number,
  limits: {
    canCreateOrg: boolean,
    canInvite: boolean,
    unlimitedSubs: boolean,
    // ...
  },
  banner: BannerInfo | null,    // см. banner-priority.ts
  refundedAt: Date | null,
}
```

## In-process TTL cache

- `Map<userId, { expiresAt, payload }>`
- **TTL_MS** = 60s
- **CACHE_MAX** = 10000 entries
- Lazy eviction при miss
- Soft cap: при достижении CACHE_MAX → sweep expired, потом drop oldest 10%

### Invalidation API

- `invalidate(userId)` — вызывается из `UserBillingRepository.applyTransition` после **каждой** успешной транзишн → `/billing/me` сразу видит новый state
- `invalidateAll()` — для cron'ов которые трогают много юзеров (`expireTrials`, `GracePeriodCron`) — вместо цикла invalidate

> 60s выбран компромиссом: достаточно длинно чтобы hot-polling клиент не лупил DB, достаточно коротко чтобы dirty-state (workspace membership) self-heal'ил за минуту. Если хочется фиксить drift — расширяй `invalidate()`, а не уменьшай TTL.

## Banner Priority (`banner-priority.ts`)

Многоканальный декларативный приоритет:

```
billing_issue > refunded > grace > trial-expiring > free-limit > none
```

Пример banner:
```json
{
  "kind": "BILLING_ISSUE",
  "title": "Couldn't renew your Pro",
  "message": "Apple is retrying payment...",
  "action": "OPEN_APPLE_BILLING",
  "severity": "error"
}
```

## Special: «User not found»

Если `findOne({ id: userId })` возвращает null → throw `NotFoundException('User not found')`.

> Mobile (≤ v1.3.20) делает **exact-string match** `'User not found'` чтобы detect'ить stale JWT (deleted account) и force-logout. **НЕ меняй wording.** Включение UUID в message сломало эту detection.

## Связанные

- [[billing-module]] — orchestrator
- [[trials]], [[reconciliation]] — источники state
- [[workspace-module]] — `isTeamOwner` / `isTeamMember`
- [[common-cross-cutting]] → `PlanGuard` / `RequirePlanCapability` (читают `limits.*`)
