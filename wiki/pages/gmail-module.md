---
title: Модуль Gmail (Inbox scan)
tags: [module, gmail, oauth, scan, ai-extraction, pro-feature, casa, limited-use]
sources:
  - src/gmail/gmail.controller.ts
  - src/gmail/gmail.service.ts
  - src/gmail/gmail-scan.service.ts
  - src/gmail/gmail.module.ts
updated: 2026-05-22
---

# Модуль Gmail

Pro/Team-feature: пользователь подключает Gmail аккаунт (OAuth2 с `gmail.readonly` scope), сервер сканирует inbox за последний год, ищет subscription receipts через `category:purchases`/known billing senders, парсит через AI ([[ai-module]]) и возвращает кандидатов на импорт в подписки.

## OAuth scopes

- `https://www.googleapis.com/auth/gmail.readonly` (Google "restricted" scope)
- `https://www.googleapis.com/auth/userinfo.email`

**Refresh token** хранится в `User.gmailRefreshToken` (encrypted at rest через `AesGcmTransformer`, key = `DATA_ENCRYPTION_KEY` env). См. [[common-cross-cutting]] → crypto.

**Google Limited Use Compliance** (User Data Policy):
1. Gmail data → только для subscription receipts
2. Не используется для рекламы
3. Не передаётся 3rd parties кроме OpenAI (для parsing — anonymized)
4. Humans не читают (кроме explicit consent / abuse / legal)

**CASA Tier 2 / ASVS V8.3.7 + V6.4.1:**
- Encrypted refresh token at rest
- DATA_ENCRYPTION_KEY отдельно от БД (env / GitHub Secrets)

## API эндпоинты

| Метод | Путь | Auth | Throttle | Описание |
|-------|------|------|----------|----------|
| `GET` | `/gmail/connect` | JWT | 5/min | Возвращает `{ authUrl }` — Google consent URL с HMAC state (state TTL 15 мин) |
| `GET` | `/gmail/callback?code=&state=` | — | — | Google redirect (public) — обмен code на tokens, redirect на mobile deep link |
| `GET` | `/gmail/status` | JWT | — | Connection state + per-plan daily quota |
| `DELETE` | `/gmail/disconnect` | JWT | — | Очистка refresh token + audit log |
| `POST` | `/gmail/scan` | JWT + `RequireProGuard` | 2/min | Sync bulk scan (до 1500 messages, lookback 365 дней) |
| `POST` | `/gmail/scan/start` | JWT + `RequireProGuard` | 4/min | Async job-based scan — возвращает `jobId` |
| `GET` | `/gmail/scan/status/:jobId` | JWT | 60/min | Poll progress (stage + current/total) |

## State HMAC

`state = userId.nonce.exp.HMAC(secret)` (base64url). Secret = `GMAIL_STATE_SECRET || JWT_REFRESH_SECRET`. Nonce single-use через Redis `gmail-oauth-nonce:{nonce}` (SETNX, TTL 15 мин) — защита от replay.

## OAuth callback flow

1. Validate code + state (HMAC + nonce SETNX)
2. POST `https://oauth2.googleapis.com/token` (timeout 8s)
3. Получаем `refresh_token` + `access_token` + scopes
4. Verify scopes содержат `gmail.readonly`
5. GET userinfo → `gmailEmail`
6. Encrypt + UPDATE `User.gmailRefreshToken`, `User.gmailEmail`, `User.gmailConnectedAt`
7. Audit log `gmail.connect.success`
8. Redirect на `GMAIL_REDIRECT_FRONTEND` (default `subradar://settings/gmail`) с `?status=connected&email=...`

Ошибки кидают user через `?status=denied|error&message=...`.

## Сканирование (`GmailScanService`)

### Лимиты и safety

- **`MAX_MESSAGES`** = 1500 (раньше 500 — увеличено после миграции `parseBulkEmails` на `gpt-4o-mini`)
- **`LOOKBACK_DAYS`** = 365 — для yearly subs (Adobe Annual, GitHub Pro yearly, домены) которые выходят 1 receipt/год
- **`SCAN_LOCK_TTL_S`** = 60 — Redis lock single-flight per user
- **`LIST_PAGE_SIZE`** = 500 (Gmail cap), пагинация с `pageToken`
- **`LIST_PAGINATION_BUDGET_MS`** = 30s — bail если inbox патологически большой
- **Daily quota per plan** (Redis daily counter `gmail:scan:daily:{userId}:{YYYY-MM-DD}`):
  - Pro: 1/день
  - Organization: 1/день (раньше 3/10 — ужесточено для контроля cost)

### Pipeline

```
listing → fetching → parsing → enriching → filtering
```

1. **listing** — Gmail `messages.list` с filter `category:purchases OR (from:no-reply OR receipt OR billing OR invoice)`
2. **fetching** — параллельные `messages.get` (с concurrency limit)
3. **parsing** — HTML strip → AI `parseBulkEmails` (chunked, gpt-4o-mini)
4. **enriching** — MarketData lookup (catalog [[catalog-module]])
5. **filtering** — дедуп против существующих subs пользователя

### Защита от prompt injection

Snippets стрипаются от HTML/scripts перед feed в LLM (defense in depth — receipt body может содержать adversarial content).

### Async-flow (`/scan/start`)

- INSERT scan job в Redis (`gmail:scan:job:{jobId}`)
- BullMQ task запускается → периодически апдейтит `ScanProgress { stage, current, total }`
- Mobile polls `/scan/status/:jobId` (или получает FCM push при completion)
- 404 если jobId неизвестен ИЛИ принадлежит другому юзеру (защита от probing)

## Audit actions

`gmail.connect.attempt`, `gmail.connect.success`, `gmail.connect.failure`, `gmail.disconnect`, `gmail.scan.started`, `gmail.scan.completed`, `gmail.scan.failed`.

## Связанные модули

- [[ai-module]] — `parseBulkEmails` (gpt-4o-mini)
- [[catalog-module]] — enrichment кандидатов после AI parse
- [[subscriptions-module]] — куда импортируются принятые подписки (ручной флоу)
- [[common-cross-cutting]] — Audit, AES-GCM encryption, RequireProGuard
- [[billing-module]] — `getEffectiveAccess` определяет Pro/Team daily quota
