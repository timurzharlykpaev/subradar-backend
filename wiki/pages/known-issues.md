---
title: Известные проблемы и ограничения
tags: [issues, bugs, limitations, displayCurrency, fx]
sources:
  - src/subscriptions/subscriptions.service.ts
  - src/analytics/analytics.service.ts
  - src/users/users.service.ts
  - src/billing/billing.service.ts
updated: 2026-04-16
---

# Известные проблемы и ограничения

## 1. displayCurrency — несогласованность между endpoint'ами

### Статус: исправлено

`GET /subscriptions?displayCurrency=KZT` теперь возвращает `displayAmount`, `displayCurrency`, `fxRate` для каждой подписки через `findAllWithDisplay()`.

Однако `GET /subscriptions/:id` (одна подписка) **не** возвращает display-поля — только сырые `amount` + `currency`.

### Текущее поведение

| Endpoint | displayCurrency конвертация | Поля |
|----------|---------------------------|------|
| `GET /subscriptions` | Да | `displayAmount`, `displayCurrency`, `fxRate`, `fxFetchedAt` |
| `GET /subscriptions/:id` | Нет | Только `amount`, `currency` |
| `GET /analytics/summary` | Да | Все суммы в displayCurrency |
| `GET /analytics/monthly` | Да | `total` в displayCurrency |
| `GET /analytics/by-category` | Да | `total` в displayCurrency |
| `GET /analytics/by-card` | Нет | В оригинальной валюте |
| `GET /analytics/forecast` | Нет | В USD |
| `GET /analytics/savings` | Нет | В оригинальной валюте |

### Рекомендация

Добавить `?displayCurrency=` параметр в:
- `GET /subscriptions/:id`
- `GET /analytics/by-card`
- `GET /analytics/forecast`
- `GET /analytics/savings`

## 2. UsersService.update() — whitelist не включает region и displayCurrency

### Статус: активная проблема

`PATCH /users/me` корректно обновляет `region` и `displayCurrency` через контроллер (прямой `repo.update`), но `UsersService.update()` не включает эти поля в whitelist `ALLOWED_KEYS`.

Это означает, что если другой сервис вызывает `usersService.update(id, { displayCurrency: 'KZT' })`, поле будет проигнорировано.

### Рекомендация

Добавить `'region'` и `'displayCurrency'` в `ALLOWED_KEYS` в `UsersService.update()`.

## 3. Forecast не конвертирует в displayCurrency

### Статус: ограничение

`GET /analytics/forecast` всегда возвращает `currency: 'USD'`, не учитывая displayCurrency пользователя. Суммы не конвертируются.

## 4. App Store Review Account

### Статус: by design

Email `review@subradar.ai` имеет фиксированный OTP-код `000000` для прохождения App Store review.

## 5. Concurrency limiter AI

### Статус: by design

Максимум 3 одновременных OpenAI-запроса на инстанс. При перегрузке — wait queue с timeout 30 секунд. В production с одним инстансом это может быть узким горлышком при нагрузке.

## 6. FX fallback провайдер не поддерживает KZT/RUB

### Статус: ограничение

Primary провайдер (open.er-api.com) поддерживает 166 валют включая KZT, RUB. Fallback (frankfurter.dev, ECB) поддерживает только ~33 валюты — без KZT, RUB, и многих других.

Если primary недоступен и в кеше/БД нет свежих курсов — конвертация в KZT/RUB будет невозможна.

## 7. Grace period — каскад на team members

### Статус: by design, потенциальная UX проблема

При EXPIRATION team owner'а все team members получают 7-дневный grace period. Но нет email/push уведомления об этом — member может не знать, что его доступ заканчивается.

## 8. Trial — deprecated endpoint

### Статус: legacy

`POST /billing/trial` помечен как deprecated — trial теперь управляется Apple/RevenueCat Introductory Offers. Но endpoint сохранён для обратной совместимости со старыми версиями приложения.

## 9. Analysis — план 'organization' не распознаётся

### Статус: потенциальный баг

`AnalysisService.getUserPlan()` проверяет `plan === 'team'`, но биллинг использует `plan === 'organization'`. Organization-пользователи могут не получать доступ к analysis.

## 10. Email import controller

### Статус: stub

`src/subscriptions/email-import.controller.ts` существует, но функциональность может быть не полностью реализована.

Подробнее: [[subscriptions-module]], [[analytics-module]], [[fx-module]], [[billing-module]]
