---
title: Модуль биллинга (Billing)
tags: [module, billing, plans, revenuecat, lemon-squeezy, trial, grace-period, workspace]
sources:
  - src/billing/billing.service.ts
  - src/billing/billing.controller.ts
  - src/billing/plans.config.ts
  - src/billing/grace-period.cron.ts
  - src/workspace/entities/workspace.entity.ts
  - src/workspace/entities/workspace-member.entity.ts
updated: 2026-04-16
---

# Модуль биллинга

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

`getEffectiveAccess(user)` — определяет что доступно пользователю ПРЯМО СЕЙЧАС:

Приоритет:
1. **Team Owner** с active org plan → `organization`
2. **Team Member** (owner платит) → `organization`
3. **Собственная RC подписка** → `pro` / `organization`
4. **Активный trial** → `pro`
5. **Grace period** → `pro` (source: `grace_team` или `grace_pro`)
6. **Всё остальное** → `free`

Возвращает:
```typescript
interface EffectiveAccess {
  plan: 'free' | 'pro' | 'organization';
  source: 'own' | 'team' | 'grace_team' | 'grace_pro' | 'free';
  graceUntil?: Date;
  graceDaysLeft?: number;
  isTeamOwner: boolean;
  isTeamMember: boolean;
  hasOwnPro: boolean;
  workspaceId?: string;
  workspaceExpiringAt?: Date;
}
```

## Trial

- 7 дней Pro (deprecated — теперь управляется Apple/RevenueCat Introductory Offers)
- `POST /billing/trial` — legacy endpoint, сохранён для обратной совместимости
- Проверка: `user.trialUsed === true` → нельзя повторно

## Grace Period

При EXPIRATION RevenueCat:
1. Пользователь получает `gracePeriodEnd = now + 7 дней`
2. Если это team owner — каскад на всех team members:
   - `workspace.expiredAt = now`
   - Все члены получают `gracePeriodEnd = now + 7 дней`, `gracePeriodReason = 'team_expired'`

Cron `GracePeriodCron`:
- `@Cron('5 0 * * *')` — сброс истёкших grace period
- `@Cron('0 9 * * *')` — удаление заброшенных workspaces (30+ дней expired)

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

Подробнее: [[auth-module]], [[users-module]], [[notifications-module]]
