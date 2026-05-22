---
title: Известные проблемы и ограничения
tags: [issues, bugs, limitations, displayCurrency, fx, backward-compat, mobile]
sources:
  - src/subscriptions/subscriptions.service.ts
  - src/analytics/analytics.service.ts
  - src/users/users.service.ts
  - src/billing/billing.service.ts
  - src/reports/reports.service.ts
updated: 2026-05-22
---

# Известные проблемы и ограничения

## 0. App Store backward compatibility (КРИТИЧНО)

Мобильное приложение **уже выпущено в App Store**. Адопшен новой версии идёт постепенно — **~50% пользователей за неделю, ~90% за 4 недели**. Старые билды продолжают ходить на тот же `api.subradar.ai/api/v1` prod.

### Правила backend-изменений

1. **Default: additive only.** Новое поведение → новое поле / `/v2/...` / новый query-параметр. **Не меняй ответ существующего эндпоинта**, на который полагаются старые клиенты.
2. **Новые request-поля делай optional с дефолтами**, совпадающими со старым поведением.
3. **Не удаляй и не переименовывай** поля, которые читают старые клиенты (даже legacy/wrong — оставь и заполняй best-effort).
4. **Server-side gating > client-side gating.** Новые лимиты/планы реализуй на сервере — старые клиенты получают fix без обновления.
5. **Не ужесточай DTO-валидацию задним числом** (новое required, более строгий regex). Loosen first, tighten after adoption.
6. **Не удаляй значения enum**, на которых клиент switch'ится (`SubscriptionStatus`, `BillingPeriod` и т.п.) — крэш на старых билдах.
7. Если изменение нельзя сделать backward-compat — **предупреди явно**: «Это сломает X на версиях ≤ A.B.C, продолжать?»
8. Bump версии в `app.json` мобилки **не помогает** старым пользователям — влияет только на новые билды.

**Escape:** force-update / kill-switch через серверный «minimum supported version» endpoint + UI блокировка — только для critical security fixes.

Конкретные примеры additive design в коде:
- `GET /analysis/latest?displayCurrency=` — старые клиенты не шлют, получают результат в исходной валюте
- `GET /gmail/status` → новое поле `dailyScans: null | {...}` — старый клиент игнорирует
- `GET /catalog/popular` — fallback на private cache когда `region`/`currency` отсутствуют (новые клиенты явные → CDN-friendly)
- Endpoint aliases (`POST /auth/google/mobile`, `POST /auth/verify`, `PUT /subscriptions/:id`, `GET /auth/profile`) — нельзя удалять
- `EffectiveAccess` сообщение `'User not found'` — exact match в mobile ≤ v1.3.20 для force-logout stale JWT, wording стабилен

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

### Статус: stub / replaced

`src/subscriptions/email-import.controller.ts` существует исторически. Боевая функциональность — Gmail OAuth + scan через [[gmail-module]] (`POST /gmail/scan` / `POST /gmail/scan/start`).

## 11. Reports — freeze на interrupted PDF generation (исправлено `f0d2d2b`)

### Статус: исправлено в мае 2026

Раньше если worker крашился в середине `buildPdf` (OOM, OOMK, contianer kill), `Report.status` оставался `GENERATING` вечно → mobile UI показывал endless spinner. Фикс:
- Try/catch вокруг `buildAndStorePdf` → UPDATE status=FAILED, error="..." при любом исключении
- См. [[reports-module]] → recent fix `f0d2d2b`
- Stuck-job recovery cron должен переводить `GENERATING > 1h` → FAILED (если ещё не реализовано — TODO)

Подробнее: [[subscriptions-module]], [[analytics-module]], [[fx-module]], [[billing-module]], [[reports-module]], [[gmail-module]]
