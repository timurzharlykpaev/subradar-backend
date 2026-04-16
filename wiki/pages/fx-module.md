---
title: Модуль FX-курсов (FX)
tags: [module, fx, currency, exchange-rates, conversion]
sources:
  - src/fx/fx.service.ts
  - src/fx/fx.cron.ts
  - src/fx/fx.controller.ts
  - src/fx/fx.module.ts
  - src/fx/entities/fx-rate-snapshot.entity.ts
updated: 2026-04-16
---

# Модуль FX-курсов

## Назначение

Получение, кеширование и конвертация валютных курсов. Базовая валюта: USD.

## Провайдеры

| Приоритет | Провайдер | URL | Особенности |
|-----------|----------|-----|-------------|
| Primary | open.er-api.com | `https://open.er-api.com/v6/latest/USD` | Бесплатный, без ключа, 166 валют, включая KZT/RUB |
| Fallback | frankfurter.dev | `https://api.frankfurter.dev/v1/latest?base=USD` | Бесплатный, ECB, ~33 валюты (без KZT/RUB) |

## Получение курсов

`getRates()`:
1. Проверяет Redis кеш (`fx:latest`, TTL 6 часов)
2. Если есть — возвращает
3. Если нет — ищет последний snapshot в PostgreSQL (`fx_rate_snapshots`)
4. Если snapshot найден и не старше 24 часов — кеширует в Redis, возвращает
5. Если snapshot старый — фоновый refresh от API, возвращает snapshot
6. Если ничего нет — синхронный fetch от API

`refreshFromApi()`:
- Redis-based single-flight lock (`fx:refresh:lock`, TTL 30 сек)
- Предотвращает параллельные API-вызовы при cold start/cron
- Если lock занят — ждёт 1.5 сек, проверяет кеш
- Перебирает провайдеров по приоритету
- Сохраняет snapshot в PostgreSQL + Redis

## Конвертация

```typescript
convert(amount: Decimal, from: string, to: string, rates: Record<string, number>): Decimal
```

Формула: `amount / rates[from] * rates[to]`

- Использует `Decimal` (decimal.js) для точности
- Бросает ошибку если курс для валюты не найден
- **Вызывающий код** должен обрабатывать ошибку (обычно fallback = 0 или original amount)

## Cron

`FxCron` — `@Cron('0 3 * * *')` — ежедневно в 3:00 UTC обновляет курсы.

## Сущность FxRateSnapshot

Таблица: `fx_rate_snapshots`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `base` | varchar | Всегда 'USD' |
| `rates` | jsonb | `{ "EUR": 0.92, "KZT": 457.05, ... }` |
| `source` | varchar | Имя провайдера |
| `fetchedAt` | timestamptz | Время получения |

## Кто использует FX

| Модуль | Как использует |
|--------|---------------|
| [[subscriptions-module]] | `findAllWithDisplay()` — конвертация при GET /subscriptions?displayCurrency= |
| [[analytics-module]] | Все аналитические эндпоинты — summary, monthly, by-category |
| [[ai-module]] | Каталог сервисов — цены в региональной валюте |

## Интерфейс

```typescript
interface FxRates {
  base: 'USD';
  rates: Record<string, number>;
  fetchedAt: Date;
  source: string;
}
```

## Константы

| Константа | Значение | Описание |
|-----------|---------|----------|
| `REDIS_KEY` | `fx:latest` | Redis-ключ для кешированных курсов |
| `REDIS_TTL_SECONDS` | 21600 (6ч) | TTL Redis-кеша |
| `STALE_THRESHOLD_MS` | 86400000 (24ч) | Порог устаревания snapshot |
| `REFRESH_LOCK_TTL_SECONDS` | 30 | TTL lock при refresh |

Подробнее: [[subscriptions-module]], [[analytics-module]]
