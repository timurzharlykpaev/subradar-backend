---
title: Модуль аналитики (Analytics)
tags: [module, analytics, fx, displayCurrency, summary, forecast, savings]
sources:
  - src/analytics/analytics.service.ts
  - src/analytics/analytics.controller.ts
updated: 2026-04-16
---

# Модуль аналитики

## Общий принцип

Все аналитические эндпоинты:
1. Принимают опциональный `?displayCurrency=XXX`
2. Если не передан — берётся `user.displayCurrency` (default: `USD`)
3. Конвертируют все суммы через [[fx-module]]
4. Кешируются в Redis (TTL 5 минут для summary)

## Эндпоинты

### GET /analytics/summary

Главная сводка. Принимает: `?month`, `?year`, `?displayCurrency`.

Ответ:
```json
{
  "totalMonthly": 150.50,
  "totalYearly": 1806.00,
  "monthlyTotal": 150.50,
  "yearlyEstimate": 1806.00,
  "activeCount": 12,
  "totalSubscriptions": 12,
  "pausedCount": 1,
  "trialCount": 0,
  "savingsPossible": 0,
  "businessExpenses": 30.00,
  "averagePerSubscription": 12.54,
  "displayCurrency": "KZT",
  "fxFetchedAt": "2026-04-16T03:00:00.000Z",
  "upcomingNext30": [
    {
      "id": "uuid",
      "name": "Netflix",
      "amount": 15.49,
      "currency": "USD",
      "displayAmount": 7078.00,
      "displayCurrency": "KZT",
      "nextPaymentDate": "2026-04-20"
    }
  ]
}
```

Алиас: `GET /analytics/home` — тот же ответ.

Кеш-ключ: `analytics:summary:{userId}:{displayCurrency}:{month}:{year}` (TTL 300 сек).

### GET /analytics/monthly

Помесячные траты за N месяцев. Принимает: `?months=12`, `?displayCurrency`.

```json
[
  { "month": 5, "year": 2026, "label": "2026-05", "total": 150.50, "displayCurrency": "KZT" },
  { "month": 4, "year": 2026, "label": "2026-04", "total": 148.00, "displayCurrency": "KZT" }
]
```

Алиас: `GET /analytics/trends`.

### GET /analytics/by-category

Траты по категориям. Принимает: `?month`, `?year`, `?displayCurrency`.

```json
[
  { "category": "STREAMING", "total": 45.00, "displayCurrency": "KZT" },
  { "category": "AI_SERVICES", "total": 40.00, "displayCurrency": "KZT" }
]
```

Алиас: `GET /analytics/categories`.

### GET /analytics/by-card

Траты по платёжным картам. **Не конвертирует в displayCurrency** (возвращает в оригинальной валюте).

```json
[
  {
    "card": { "id": "uuid", "nickname": "Kaspi Gold", "last4": "4242", "brand": "visa", "color": "#FFD700" },
    "subscriptions": 5,
    "total": 89.50
  },
  {
    "card": { "id": null, "nickname": "Unassigned", "last4": null, "brand": null, "color": null },
    "subscriptions": 3,
    "total": 61.00
  }
]
```

### GET /analytics/upcoming

Подписки с ближайшими списаниями. Принимает: `?days=7`.

### GET /analytics/trials

Подписки в статусе TRIAL с информацией о сроках:
```json
[
  {
    "...subscription",
    "daysUntilTrialEnd": 3,
    "isExpiringSoon": true,
    "isExpired": false
  }
]
```

### GET /analytics/forecast

Прогноз расходов (без FX-конвертации — в USD):
```json
{
  "forecast30d": 150.50,
  "forecast6mo": 903.00,
  "forecast12mo": 1806.00,
  "currency": "USD"
}
```

### GET /analytics/savings

Анализ потенциальных сбережений (дубликаты по категориям):
```json
{
  "estimatedMonthlySavings": 15.49,
  "duplicates": [
    {
      "subscriptionIds": ["uuid1", "uuid2"],
      "name": "Netflix, Disney+",
      "category": "STREAMING",
      "count": 2,
      "totalMonthly": 38.48,
      "cheapest": 7.99,
      "potentialSavings": 15.49
    }
  ],
  "insights": [
    { "type": "overlap_count", "data": { "count": 1 } },
    { "type": "biggest_overlap", "data": { "name": "Netflix, Disney+", "category": "STREAMING", "savings": 15.49 } }
  ]
}
```

## Конвертация displayCurrency в аналитике

Метод `resolveDisplayCurrency(userId, override)`:
1. Если передан `?displayCurrency=XXX` и это валидный 3-буквенный код → используется он
2. Иначе → `user.displayCurrency` (из профиля)
3. Fallback → `'USD'`

Метод `convertAmount(amount, from, to, rates)`:
1. Если `from === to` → возвращает amount
2. Конвертирует через `fx.convert()` (Decimal)
3. Если конвертация не удалась (неизвестная валюта) → возвращает 0 и логирует warning
4. Это намеренно: лучше исключить из агрегата, чем смешать валюты

Метод `toMonthlyAmount(amount, period)`:
- WEEKLY → amount * 4.33
- MONTHLY → amount
- QUARTERLY → amount / 3
- YEARLY → amount / 12
- LIFETIME / ONE_TIME → 0

## Кеширование

- `analytics:summary:{userId}:{displayCurrency}:{month}:{year}` → TTL 5 минут
- Инвалидируется при create/update/delete подписки (см. [[subscriptions-module]])

Подробнее: [[fx-module]], [[subscriptions-module]], [[billing-module]]
