---
title: Модуль каталога сервисов (Catalog)
tags: [module, catalog, services, plans, regional-pricing, ai-research, bullmq]
sources:
  - src/catalog/catalog.controller.ts
  - src/catalog/catalog.service.ts
  - src/catalog/catalog.module.ts
  - src/catalog/ai-catalog.provider.ts
  - src/catalog/catalog-refresh.cron.ts
  - src/catalog/catalog-refresh.processor.ts
  - src/catalog/seed-regional-prices.ts
  - src/catalog/entities/catalog-service.entity.ts
  - src/catalog/entities/catalog-plan.entity.ts
  - src/catalog/dto/search-catalog.dto.ts
updated: 2026-05-22
---

# Модуль каталога

Персистентный справочник subscription-сервисов (Netflix, Spotify, ChatGPT и т.п.) с regional pricing. Источники данных: AI research (через `AiCatalogProvider`, OpenAI web_search_preview), seed файлы, manual.

## Сущности

### CatalogService (`catalog_services`)

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `slug` | varchar(64) UNIQUE | Url-safe (`netflix`, `chatgpt-plus`) |
| `name` | varchar(128) | "Netflix" |
| `category` | enum(SubscriptionCategory) | См. [[subscriptions-module]] |
| `iconUrl` | text | nullable |
| `websiteUrl` | text | nullable |
| `aliases` | text[] | Альтернативные имена для fuzzy match |
| `lastResearchedAt` | timestamptz | Когда последний AI-research |
| `researchCount` | int | Сколько раз research'ился |
| `createdAt` | timestamp | |

### CatalogPlan (`catalog_plans`)

UNIQUE(`serviceId`, `region`, `planName`).

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `serviceId` | UUID | FK → catalog_services (CASCADE) |
| `region` | varchar(2) | ISO 3166-1 alpha-2 (`US`, `KZ`, `RU`) |
| `planName` | varchar(128) | "Standard", "Premium" |
| `price` | decimal(19,4) | |
| `currency` | varchar(3) | ISO 4217 |
| `period` | enum | `MONTHLY` / `YEARLY` / etc. |
| `trialDays` | int | nullable |
| `features` | text[] | |
| `priceSource` | enum | `AI_RESEARCH` / `USER_REPORTED` / `MANUAL` |
| `priceConfidence` | enum | `HIGH` / `MEDIUM` / `LOW` |
| `lastPriceRefreshAt` | timestamptz | nullable |

Индексы: `(lastPriceRefreshAt)`, `(serviceId, region)`.

## API эндпоинты

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| `GET` | `/catalog/popular?region=&currency=&limit=` | JWT | Топ-сервисов в регионе (Redis cache 1h) |
| `GET` | `/catalog/search?q=&region=` | JWT | Поиск (slug + alias) — возвращает service + plans |
| `POST` | `/catalog/seed-prices` | JWT + ADMIN_EMAILS | One-time seed regional prices (admin only) |

`/catalog/popular`:
- Edge-кеш `public, max-age=300, s-maxage=3600, swr=600` если **обе** `region` + `currency` явные (детерминистичная cache key)
- Иначе `private, max-age=60` (fallback на user prefs → response varies per caller → нельзя в public CDN)
- Backward compat: старые App Store binaries не шлют параметры — попадают в private branch

`/catalog/search`:
1. Нормализует query → slug (sanitize: control chars + quotes/braces stripped, 200-char cap)
2. SELECT по slug в БД
3. Если найдено + свежий (≤ 30 дней) → возврат
4. Если stale → enqueue background refresh (`catalog-refresh` queue)
5. Если не найдено → Redis lock `catalog:lookup:{slug}` → `AiCatalogProvider.research(name, region)` → INSERT service + plans → возврат
6. Lock TTL 60s, poll каждые 500ms, max wait 20s

## AiCatalogProvider

Использует OpenAI `gpt-4o` с `web_search_preview` tool. Промпт ищет:
- Plan names + prices в указанном регионе
- Currency, billing period
- Trial days, features

Возвращает Confidence (HIGH если direct источник, MEDIUM если inferred, LOW если placeholder).

## Cron `catalogRefreshTopServices`

`@Cron('0 4 * * 1')` — понедельник 4:00 UTC.

1. Собирает regions: `BASE_REGIONS = ['US','KZ','RU','UA','TR','DE']` + DISTINCT user regions
2. Топ-50 сервисов по count подписок ссылающихся на них
3. Для каждого enqueue `refreshServicePrices` в BullMQ queue `catalog-refresh` (с jobId `refresh:{serviceId}:{YYYY-MM-DD}` — daily dedup)
4. Budget cap: `WEEKLY_BUDGET_CAP = 1000` jobs

### CatalogRefreshProcessor

- На каждый job → AiCatalogProvider per region
- UPSERT CatalogPlan с новыми ценами
- UPDATE service.lastResearchedAt, researchCount++
- Retry: 2 attempts, exponential backoff 30s

## Seed

`POST /catalog/seed-prices` (admin-only через `ADMIN_EMAILS` env) запускает `seedRegionalPrices(dataSource)` — захардкоженные цены для топ-100 сервисов в 6 регионах.

## Subscription linkage

Когда юзер создаёт подписку с `catalogPlanId`, [[subscriptions-module]] автоматически подтягивает:
- `name`, `iconUrl` из CatalogService
- `amount`, `currency`, `billingPeriod` из CatalogPlan
- `category` из CatalogService

## Связанные модули

- [[ai-module]] — `gpt-4o` + web_search_preview для research
- [[fx-module]] — конвертация цен для отображения
- [[subscriptions-module]] — usage сайт (catalogServiceId, catalogPlanId FKs)
- [[gmail-module]] — enrichment результатов scan'а
- [[analysis-module]] — `MarketDataService` смотрит сюда сначала
