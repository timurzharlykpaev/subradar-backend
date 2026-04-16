---
title: Модуль AI
tags: [module, ai, openai, wizard, voice, screenshot, lookup, analysis, catalog]
sources:
  - src/ai/ai.service.ts
  - src/ai/ai.controller.ts
  - src/ai/dto/ai.dto.ts
  - src/analysis/analysis.service.ts
  - src/analysis/analysis.processor.ts
  - src/analysis/analysis.cron.ts
  - src/analysis/analysis.constants.ts
  - src/analysis/market-data.service.ts
  - src/catalog/catalog.service.ts
  - src/catalog/ai-catalog.provider.ts
  - src/catalog/entities/catalog-service.entity.ts
  - src/catalog/entities/catalog-plan.entity.ts
updated: 2026-04-16
---

# Модуль AI

## Общая архитектура

- **Провайдер:** OpenAI (GPT-4o)
- **Модель:** настраивается через `OPENAI_MODEL` env (default: `gpt-4o`)
- **Concurrency:** семафор на 3 одновременных запроса + wait queue (timeout 30s)
- **JSON mode:** `response_format: { type: 'json_object' }` для всех промптов
- **Temperature:** 0.1-0.2 (детерминированные ответы)
- **Все AI-эндпоинты** потребляют AI-запрос (`billingService.consumeAiRequest()`)

## Эндпоинты

### POST /ai/wizard (главный)

Конверсационный wizard — один endpoint управляет всем диалогом добавления подписки.

Запрос:
```json
{
  "message": "Netflix",
  "context": { "preferredCurrency": "KZT" },
  "locale": "ru",
  "history": [
    { "role": "user", "content": "Netflix" },
    { "role": "assistant", "content": "{...}" }
  ]
}
```

Ответы (3 схемы):

**A) Одна подписка (конкретный план):**
```json
{
  "done": true,
  "subscription": {
    "name": "ChatGPT Plus",
    "amount": 20.00,
    "currency": "USD",
    "billingPeriod": "MONTHLY",
    "category": "AI_SERVICES",
    "serviceUrl": "https://chat.openai.com",
    "cancelUrl": "https://help.openai.com",
    "iconUrl": "https://icon.horse/icon/openai.com"
  }
}
```

**B) Несколько планов (амбигуация):**
```json
{
  "done": true,
  "plans": [
    { "name": "Netflix Standard with Ads", "amount": 7.99, "billingPeriod": "MONTHLY", "currency": "USD" },
    { "name": "Netflix Standard", "amount": 15.49, "billingPeriod": "MONTHLY", "currency": "USD" },
    { "name": "Netflix Premium", "amount": 22.99, "billingPeriod": "MONTHLY", "currency": "USD" }
  ],
  "serviceName": "Netflix",
  "iconUrl": "https://icon.horse/icon/netflix.com",
  "serviceUrl": "https://netflix.com",
  "cancelUrl": "https://netflix.com/cancelplan",
  "category": "STREAMING"
}
```

**C) Нужна информация:**
```json
{
  "done": false,
  "question": "Сколько стоит подписка X?",
  "field": "amount",
  "partialContext": { "name": "SomeService" }
}
```

**Особенности wizard:**
- Содержит встроенную базу цен 100+ сервисов (хардкод в промпте)
- При неизвестном сервисе пытается web search через `gpt-4o-mini` + `web_search_preview` tool
- `iconUrl` всегда через `icon.horse`
- История ограничена 8 последними сообщениями, каждое до 500 символов
- Язык `question` определяется по `locale`

### POST /ai/lookup

Поиск сервиса по имени. Принимает: `{ query, locale?, country? }`.

Возвращает:
```json
{
  "name": "Netflix",
  "serviceUrl": "https://www.netflix.com",
  "cancelUrl": "https://www.netflix.com/cancelplan",
  "category": "STREAMING",
  "iconUrl": "https://icon.horse/icon/netflix.com",
  "plans": [
    { "name": "Standard", "price": 15.49, "currency": "USD", "period": "MONTHLY" }
  ],
  "priceNote": "Current as of 2026-01"
}
```

Кешируется в Redis: `ai:lookup:{query}:{locale}:{country}` → TTL 24 часа.

Алиасы: `POST /ai/lookup-service`, `POST /ai/search`.

### POST /ai/parse-screenshot

Парсинг скриншота подписки. Принимает:
- Body: `{ imageBase64 }` ИЛИ multipart `file`
- Валидация magic bytes: JPEG, PNG, WebP, GIF

Использует GPT-4o Vision. Возвращает:
```json
{
  "name": "Netflix",
  "amount": 15.49,
  "currency": "USD",
  "billingPeriod": "MONTHLY",
  "date": "2026-04-01",
  "planName": "Standard",
  "category": "STREAMING"
}
```

### POST /ai/voice-to-subscription

Голосовой ввод. Принимает:
- Body: `{ audioBase64, locale? }` ИЛИ multipart `file`
- Форматы: M4A, MP3, OGG, WebM, FLAC
- Автодетект формата по magic bytes

Процесс: Whisper → транскрипция → GPT-4o → JSON с данными подписки.

Алиас: `POST /ai/voice` (body only).

### POST /ai/parse-audio

Только транскрипция (без парсинга подписки). Возвращает `{ text }`.

### POST /ai/parse-bulk

Парсинг нескольких подписок из текста:
```json
// Запрос
{ "text": "Netflix $15, Spotify $10, iCloud $3", "locale": "ru", "currency": "KZT" }

// Ответ
{ "subscriptions": [...], "text": "Netflix $15, Spotify $10, iCloud $3" }
```

### POST /ai/voice-bulk

Голосовой ввод + парсинг нескольких подписок.

### POST /ai/match-service

Fuzzy-поиск сервиса:
```json
{ "name": "netfli" }
→ { "matches": [{ "name": "Netflix", "confidence": 0.95, "iconUrl": "...", "website": "...", "category": "STREAMING" }] }
```

### POST /ai/suggest-cancel

URL и инструкции для отмены подписки:
```json
{ "serviceName": "Netflix" }
→ { "cancelUrl": "https://...", "steps": ["Go to Account", "Click Cancel Membership", ...] }
```

### GET /ai/service-catalog/:serviceName

**Бесплатный** lookup из БД-каталога (без AI-вызова, без потребления лимита).

## Модуль Analysis (глубокий AI-анализ)

Отдельный от AiModule, использует BullMQ для асинхронной обработки.

### Эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| `POST /analysis/run` | Запуск анализа | |
| `GET /analysis/latest` | Последний результат + активный job | |
| `GET /analysis/job/:id` | Статус конкретного job | |
| `GET /analysis/usage` | Статистика использования | |

### Job lifecycle

```
QUEUED → COLLECTING → NORMALIZING → LOOKING_UP → ANALYZING → COMPLETED | FAILED
```

### Дедупликация

- SHA-256 хеш input data (userId + subscriptions + locale)
- Если свежий результат с таким хешем уже есть — возвращается кешированный
- Если job с таким хешем уже в работе — возвращается его ID

### Trigger types

- `MANUAL` — пользователь нажал кнопку
- `AUTO` / `CRON` — автоматический
- `SUBSCRIPTION_CHANGE` — при изменении подписок (debounced через Redis, TTL = `subscriptionChangeDebounceMins`)

### Лимиты (по планам)

| | Pro | Team |
|-|-----|------|
| Manual/week | ограничен | ограничен |
| Auto/week | ограничен | ограничен |
| Manual cooldown | 24h | — |

## Модуль Catalog (каталог сервисов)

Персистентный каталог сервисов и их планов.

### Сущности

**CatalogService** (таблица `catalog_services`):
- `slug` (unique) — url-safe идентификатор
- `name`, `category`, `iconUrl`, `websiteUrl`
- `aliases` — альтернативные названия
- `lastResearchedAt`, `researchCount`

**CatalogPlan** (таблица `catalog_plans`):
- `serviceId` → FK на CatalogService
- `region` — код региона (US, KZ, etc.)
- `planName`, `price`, `currency`, `period`
- `trialDays`, `features`
- `priceSource`: AI_RESEARCH
- `priceConfidence`: HIGH/MEDIUM/LOW
- `lastPriceRefreshAt`

### Поиск

`CatalogService.search(query, region)`:
1. Нормализует query → slug
2. Ищет в БД по slug
3. Если найдено — проверяет свежесть (30 дней)
   - Если stale — ставит в очередь фоновое обновление
4. Если не найдено — блокирует через Redis lock → AI research → сохраняет
5. Redis lock предотвращает параллельные AI-вызовы для того же сервиса

**Фоновое обновление цен:** BullMQ queue `catalog-refresh`.

Подробнее: [[billing-module]], [[fx-module]], [[subscriptions-module]]
