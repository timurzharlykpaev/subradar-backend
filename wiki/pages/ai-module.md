---
title: Модуль AI (LLM gateway)
tags: [module, ai, openai, wizard, voice, screenshot, lookup, gateway]
sources:
  - src/ai/ai.service.ts
  - src/ai/ai.controller.ts
  - src/ai/dto/ai.dto.ts
updated: 2026-05-22
---

# Модуль AI

> **Scope:** этот модуль — **gateway к LLM** (OpenAI). Все user-facing AI features где результат нужен «здесь и сейчас»: wizard, voice-to-subscription, screenshot parsing, service lookup, bulk parsing.
>
> **Глубокий AI-анализ подписок** (рекомендации, дубликаты, team overlaps) живёт в отдельном [[analysis-module]] — там BullMQ pipeline и persisted results.
>
> **Каталог сервисов** с regional pricing и фоновым AI research — в [[catalog-module]].
>
> **Gmail inbox scan** (Pro/Team feature) — в [[gmail-module]] (использует этот модуль для parseBulkEmails).

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

## См. также

- [[analysis-module]] — глубокий AI-анализ подписок (рекомендации, дубликаты, team overlaps) на BullMQ
- [[catalog-module]] — персистентный каталог сервисов с regional pricing (AI research)
- [[gmail-module]] — Pro/Team Gmail inbox scan (использует `parseBulkEmails` отсюда)
- [[billing-module]] — `consumeAiRequest()` — потребление AI-лимитов
- [[fx-module]] — конвертация при presenting result в displayCurrency
- [[subscriptions-module]] — куда импортируются результаты AI
