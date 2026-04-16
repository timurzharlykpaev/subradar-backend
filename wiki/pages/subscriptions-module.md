---
title: Модуль подписок (Subscriptions)
tags: [module, subscriptions, crud, entity, fx, displayCurrency]
sources:
  - src/subscriptions/subscriptions.service.ts
  - src/subscriptions/subscriptions.controller.ts
  - src/subscriptions/entities/subscription.entity.ts
  - src/subscriptions/dto/create-subscription.dto.ts
  - src/subscriptions/dto/filter-subscriptions.dto.ts
  - src/subscriptions/guards/subscription-limit.guard.ts
  - src/subscriptions/trial-checker.cron.ts
updated: 2026-04-16
---

# Модуль подписок

## Сущность Subscription

Таблица: `subscriptions`

### Ключевые поля

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `userId` | UUID | FK → users |
| `name` | string | Название сервиса |
| `category` | enum | Категория (16 значений) |
| `amount` | decimal(10,2) | Сумма |
| `currency` | string | Текущая валюта (может быть переписана при смене displayCurrency) |
| `originalCurrency` | varchar(3) | Исходная валюта при создании (NOT NULL) |
| `billingPeriod` | enum | MONTHLY/YEARLY/WEEKLY/QUARTERLY/LIFETIME/ONE_TIME |
| `startDate` | date | Дата начала |
| `nextPaymentDate` | date | Следующая дата списания (вычисляется автоматически) |
| `status` | enum | ACTIVE/PAUSED/CANCELLED/TRIAL |
| `trialEndDate` | date | Дата окончания триала |
| `paymentCardId` | UUID | FK → payment_cards (nullable) |
| `catalogServiceId` | UUID | FK → catalog_services (nullable) |
| `catalogPlanId` | UUID | FK → catalog_plans (nullable) |
| `reminderDaysBefore` | int[] | За сколько дней до списания напомнить [1, 3] |
| `reminderEnabled` | boolean | Включены ли напоминания |
| `isBusinessExpense` | boolean | Бизнес-расход |
| `addedVia` | enum | MANUAL/AI_VOICE/AI_SCREENSHOT/AI_TEXT |
| `aiMetadata` | jsonb | Метаданные AI-распознавания |
| `color` | varchar(7) | HEX-цвет (#FF5733) |
| `tags` | simple-json | Массив тегов |

### Категории (16 значений — UPPERCASE)

```
STREAMING | AI_SERVICES | INFRASTRUCTURE | PRODUCTIVITY | MUSIC | GAMING
NEWS | HEALTH | EDUCATION | FINANCE | DESIGN | SECURITY | DEVELOPER
SPORT | BUSINESS | OTHER
```

**Критично:** фронт и мобилка завязаны на эти значения — не менять.

### Статусы подписки

```
TRIAL → ACTIVE → PAUSED → ACTIVE (restore)
ACTIVE → CANCELLED
TRIAL → CANCELLED
```

### Индексы

- `(userId, status)` — для фильтрации активных
- `(userId, category)` — для группировки по категориям
- `(userId, createdAt)` — для сортировки
- `nextPaymentDate` — для cron-напоминаний

## API эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| `GET /subscriptions` | Список подписок | Принимает `?displayCurrency=KZT` |
| `POST /subscriptions` | Создание | Guard: SubscriptionLimitGuard |
| `GET /subscriptions/:id` | Одна подписка | |
| `PATCH /subscriptions/:id` | Обновление | |
| `PUT /subscriptions/:id` | Обновление (alias для мобилки) | |
| `DELETE /subscriptions/:id` | Удаление | |
| `POST /subscriptions/:id/cancel` | Отмена | Ставит статус CANCELLED |
| `POST /subscriptions/:id/pause` | Пауза | Ставит статус PAUSED |
| `POST /subscriptions/:id/restore` | Восстановление | Ставит статус ACTIVE |
| `POST /subscriptions/:id/archive` | Архивирование | = cancel |
| `GET /subscriptions/limits/check` | Проверка лимитов | |
| `GET /subscriptions/:id/receipts` | Чеки подписки | |
| `POST /subscriptions/:id/receipts` | Загрузка чека (file upload) | |

## displayCurrency конвертация (GET /subscriptions)

`GET /subscriptions?displayCurrency=KZT` вызывает `findAllWithDisplay()`:

1. Определяет `displayCurrency`: параметр из query → `user.displayCurrency` → `'USD'`
2. Загружает все подписки пользователя + актуальные FX-курсы (параллельно)
3. Для каждой подписки:
   - `origCurrency = sub.originalCurrency || sub.currency`
   - Конвертирует `sub.amount` из `origCurrency` в `displayCurrency` через [[fx-module]]
   - Вычисляет `fxRate = rates[displayCurrency] / rates[origCurrency]`
4. Возвращает объект с дополнительными полями:

```typescript
{
  ...subscription,
  displayAmount: "4570.50",     // string, 2 знака
  displayCurrency: "KZT",       // 3-буквенный код
  fxRate: 457.05,               // число
  fxFetchedAt: "2026-04-16..."  // Date
}
```

**Fallback:** если конвертация не удалась — `displayAmount = String(sub.amount)`, `fxRate = 1`.

## Создание подписки

При создании (`create()`):
1. Проверяется лимит подписок по плану (Free: 3, Pro/Org: unlimited)
2. Если передан `catalogPlanId` — подтягивает данные из каталога (serviceId, currency)
3. `currency` и `originalCurrency` устанавливаются из DTO, каталога или `user.displayCurrency`
4. Вычисляется `nextPaymentDate` из `startDate` + `billingPeriod`
5. Инвалидируется кеш аналитики
6. Триггерится re-evaluation анализа (debounced)

## nextPaymentDate

Вычисляется функцией `computeNextPaymentDate(startDate, billingPeriod)`:
- Итерирует от startDate вперёд на период (week/month/quarter/year)
- Возвращает первую дату в будущем
- Для LIFETIME/ONE_TIME — возвращает `null`
- Корректно обрабатывает переход месяцев (31 → 28 февраля)

Cron `@Cron('0 0 * * *')` — ежедневно пересчитывает nextPaymentDate для всех активных подписок.

## Инвалидация кеша

При любом изменении подписки (create/update/delete/status) инвалидируются Redis-ключи:
- `ai:*{userId}*`
- `analytics:*{userId}*`

Подробнее: [[fx-module]], [[analytics-module]], [[billing-module]]
