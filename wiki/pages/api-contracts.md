---
title: API контракты
tags: [api, endpoints, contracts, mobile, web]
sources:
  - src/auth/auth.controller.ts
  - src/subscriptions/subscriptions.controller.ts
  - src/analytics/analytics.controller.ts
  - src/ai/ai.controller.ts
  - src/billing/billing.controller.ts
  - src/users/users.controller.ts
  - src/notifications/notifications.controller.ts
  - src/reports/reports.controller.ts
  - src/payment-cards/payment-cards.controller.ts
  - src/workspace/workspace.controller.ts
  - src/analysis/analysis.controller.ts
  - src/gmail/gmail.controller.ts
  - src/catalog/catalog.controller.ts
  - src/receipts/receipts.controller.ts
  - docs/API_CONTRACTS.md
updated: 2026-05-22
---

# API контракты

Базовый URL: `/api/v1`

Все защищённые эндпоинты требуют `Authorization: Bearer {accessToken}`.

## Auth

| Метод | Путь | Auth | Body | Описание |
|-------|------|------|------|----------|
| `POST` | `/auth/register` | — | `{ email, password, name? }` | Регистрация |
| `POST` | `/auth/login` | — | `{ email, password }` | Вход |
| `GET` | `/auth/google` | — | — | Google OAuth redirect |
| `GET` | `/auth/google/callback` | — | — | Google callback |
| `POST` | `/auth/google/token` | — | `{ accessToken? }` или `{ idToken? }` | Google token login |
| `POST` | `/auth/google/mobile` | — | `{ idToken? }` или `{ accessToken? }` | Google mobile (alias) |
| `POST` | `/auth/apple` | — | `{ idToken, name? }` | Apple Sign-In |
| `POST` | `/auth/magic-link` | — | `{ email }` | Отправка magic link |
| `GET` | `/auth/magic` | — | `?token=xxx` | Верификация magic link (web) |
| `POST` | `/auth/verify` | — | `{ token }` | Верификация magic link (mobile) |
| `POST` | `/auth/otp/send` | — | `{ email }` | Отправка OTP |
| `POST` | `/auth/otp/verify` | — | `{ email, code }` | Верификация OTP |
| `POST` | `/auth/refresh` | — | `{ refreshToken }` | Обновление токенов |
| `POST` | `/auth/logout` | JWT | — | Выход |
| `GET` | `/auth/me` | JWT | — | Текущий пользователь |
| `GET` | `/auth/profile` | JWT | — | Alias /auth/me (mobile) |
| `POST` | `/auth/profile` | JWT | `{ name?, ... }` | Обновление профиля (mobile) |

## Users

| Метод | Путь | Auth | Body | Описание |
|-------|------|------|------|----------|
| `GET` | `/users/me` | JWT | — | Текущий пользователь |
| `PATCH` | `/users/me` | JWT | `{ name?, avatarUrl?, fcmToken?, region?, displayCurrency?, timezoneDetected? }` | Обновление профиля |
| `DELETE` | `/users/me` | JWT | — | Удаление аккаунта |
| `PATCH` | `/users/preferences` | JWT | `{ timezone?, locale?, dateFormat?, notificationsEnabled?, currency?, country? }` | Настройки |

## Subscriptions

| Метод | Путь | Auth | Body/Query | Описание |
|-------|------|------|------------|----------|
| `GET` | `/subscriptions` | JWT | `?status, ?category, ?search, ?sort, ?order, ?limit, ?offset, ?displayCurrency` | Список |
| `POST` | `/subscriptions` | JWT | `CreateSubscriptionDto` | Создание |
| `GET` | `/subscriptions/limits/check` | JWT | — | Проверка лимитов |
| `GET` | `/subscriptions/:id` | JWT | — | Одна подписка |
| `PATCH` | `/subscriptions/:id` | JWT | `Partial<CreateSubscriptionDto>` | Обновление |
| `PUT` | `/subscriptions/:id` | JWT | `Partial<CreateSubscriptionDto>` | Обновление (alias) |
| `DELETE` | `/subscriptions/:id` | JWT | — | Удаление |
| `POST` | `/subscriptions/:id/cancel` | JWT | — | Отмена |
| `POST` | `/subscriptions/:id/pause` | JWT | — | Пауза |
| `POST` | `/subscriptions/:id/restore` | JWT | — | Восстановление |
| `POST` | `/subscriptions/:id/archive` | JWT | — | Архивация |
| `GET` | `/subscriptions/:id/receipts` | JWT | — | Чеки подписки |
| `POST` | `/subscriptions/:id/receipts` | JWT | multipart `file` | Загрузка чека |
| `DELETE` | `/subscriptions/:id/receipts/:receiptId` | JWT | — | Удаление чека |

## Analytics

| Метод | Путь | Auth | Query | Описание |
|-------|------|------|-------|----------|
| `GET` | `/analytics/summary` | JWT | `?month, ?year, ?displayCurrency` | Сводка |
| `GET` | `/analytics/home` | JWT | — | Alias summary |
| `GET` | `/analytics/monthly` | JWT | `?months, ?displayCurrency` | Помесячно |
| `GET` | `/analytics/trends` | JWT | — | Alias monthly |
| `GET` | `/analytics/by-category` | JWT | `?month, ?year, ?displayCurrency` | По категориям |
| `GET` | `/analytics/categories` | JWT | — | Alias by-category |
| `GET` | `/analytics/by-card` | JWT | — | По картам |
| `GET` | `/analytics/upcoming` | JWT | `?days` | Ближайшие списания |
| `GET` | `/analytics/trials` | JWT | — | Подписки в trial |
| `GET` | `/analytics/forecast` | JWT | — | Прогноз |
| `GET` | `/analytics/savings` | JWT | — | Потенциальные сбережения |

## AI

| Метод | Путь | Auth | Body | Описание |
|-------|------|------|------|----------|
| `POST` | `/ai/wizard` | JWT | `{ message, context?, locale?, history? }` | AI-wizard диалог |
| `POST` | `/ai/lookup` | JWT | `{ query, locale?, country? }` | Поиск сервиса |
| `POST` | `/ai/lookup-service` | JWT | — | Alias lookup |
| `POST` | `/ai/search` | JWT | — | Alias lookup |
| `POST` | `/ai/parse-screenshot` | JWT | `{ imageBase64 }` или multipart `file` | Парсинг скриншота |
| `POST` | `/ai/voice-to-subscription` | JWT | `{ audioBase64, locale? }` или multipart `file` | Голос → подписка |
| `POST` | `/ai/voice` | JWT | `{ audioBase64, locale? }` | Голос → подписка (body) |
| `POST` | `/ai/parse-audio` | JWT | multipart `file` | Только транскрипция |
| `POST` | `/ai/parse-text` | JWT | `{ text }` | Текст → lookup |
| `POST` | `/ai/parse-bulk` | JWT | `{ text, locale?, currency?, country? }` | Массовый парсинг |
| `POST` | `/ai/voice-bulk` | JWT | multipart `audio` | Голос → массовый парсинг |
| `POST` | `/ai/match-service` | JWT | `{ name }` | Fuzzy-поиск |
| `POST` | `/ai/suggest-cancel` | — | `{ serviceName }` | URL отмены |
| `GET` | `/ai/subscription-insights` | JWT | — | Инсайты (stub) |
| `GET` | `/ai/service-catalog/:serviceName` | JWT | — | DB-каталог (бесплатный) |

## Billing

| Метод | Путь | Auth | Body | Описание |
|-------|------|------|------|----------|
| `GET` | `/billing/plans` | — | — | Список планов |
| `GET` | `/billing/me` | JWT | — | Информация о биллинге |
| `POST` | `/billing/checkout` | JWT | `{ variantId?, planId?, billing? }` | Создание checkout (LS) |
| `POST` | `/billing/trial` | JWT | — | Начать trial (deprecated) |
| `POST` | `/billing/cancel` | JWT | — | Отмена подписки |
| `POST` | `/billing/invite` | JWT | `{ email }` | Pro invite |
| `DELETE` | `/billing/invite` | JWT | — | Удалить invite |
| `POST` | `/billing/sync-revenuecat` | JWT | `{ productId }` | Синхронизация RC |
| `POST` | `/billing/webhook` | — | Lemon Squeezy payload | LS webhook |
| `POST` | `/billing/revenuecat-webhook` | — | RevenueCat payload | RC webhook |

## Notifications

| Метод | Путь | Auth | Body | Описание |
|-------|------|------|------|----------|
| `POST` | `/notifications/push-token` | JWT | `{ token, platform? }` | Регистрация push |
| `GET` | `/notifications/settings` | JWT | — | Настройки уведомлений |
| `PUT` | `/notifications/settings` | JWT | `{ enabled?, daysBefore?, emailNotifications?, weeklyDigestEnabled? }` | Обновление |
| `POST` | `/notifications/test` | JWT | `{ title, message }` | Тестовое push |

## Analysis

См. [[analysis-module]].

| Метод | Путь | Auth | Body / Query | Описание |
|-------|------|------|--------------|----------|
| `POST` | `/analysis/run` | JWT + AnalysisPlanGuard | `{ locale?, currency?, region?, country? }` | Запуск manual (10/min throttle) |
| `GET` | `/analysis/latest` | JWT + AnalysisPlanGuard | `?displayCurrency=` | Последний result + active job + canRunManual (FX-converted если ?displayCurrency) |
| `GET` | `/analysis/status/:jobId` | JWT + AnalysisPlanGuard | — | Прогресс (`stageProgress`) |
| `GET` | `/analysis/usage` | JWT + AnalysisPlanGuard | — | Недельная статистика |

## Workspace (Team plan)

См. [[workspace-module]].

| Метод | Путь | Auth/Guard | Описание |
|-------|------|------------|----------|
| `POST` | `/workspace` | JWT + PlanGuard(canCreateOrg) | Создать (3/min) |
| `GET` | `/workspace/me` | JWT | Текущий workspace user'а |
| `GET` | `/workspace/me/analytics?displayCurrency=` | JWT | Aggregated workspace analytics (5 мин cache) |
| `GET` | `/workspace/me/members?page=&limit=&sort=` | JWT | Paginated members (owner-only) |
| `GET` | `/workspace/me/overlaps` | JWT | Team overlaps из последнего AnalysisResult (owner-only) |
| `POST` | `/workspace/me/analysis/run` | JWT | Team analysis |
| `GET` | `/workspace/me/analysis/latest` | JWT | Latest team analysis |
| `POST` | `/workspace/me/reports/generate` | JWT | Async team PDF (owner-only, 202 Accepted) |
| `GET` | `/workspace/:id` | JWT | Один workspace (member-only) |
| `POST` | `/workspace/:id/invite` | JWT + PlanGuard(canInvite) | Email invite (20/min) |
| `POST` | `/workspace/:id/invite-code` | JWT | Сгенерировать invite-код (10/min, max 5 active codes) |
| `POST` | `/workspace/join/:code` | JWT | Join по коду (10/min, Redis-lock) |
| `POST` | `/workspace/:id/leave` | JWT | Покинуть |
| `DELETE` | `/workspace/:id` | JWT | Удалить (owner-only) |
| `PATCH` | `/workspace/:id` | JWT | Переименовать (owner/admin, 10/min) |
| `DELETE` | `/workspace/:id/members/:memberId` | JWT | Удалить члена (owner-only) |
| `PATCH` | `/workspace/:id/members/:memberId/role` | JWT | Сменить роль (owner-only, 20/min) |
| `POST` | `/workspace/:id/transfer-owner` | JWT | Передать ownership (3/min, body требует `confirm: "TRANSFER"`) |
| `GET` | `/workspace/:id/members/:memberId/subscriptions` | JWT | Subs члена (owner/admin) |
| `GET` | `/workspace/me/members/:memberId/subscriptions` | JWT | Subs члена auto-detect workspace |

## Reports

См. [[reports-module]].

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| `POST` | `/reports/generate` | JWT | Async enqueue PDF, 202 Accepted. Body: `{ type, from?, to?, startDate?, endDate?, format?, locale?, displayCurrency? }` |
| `GET` | `/reports` | JWT | Список своих отчётов |
| `GET` | `/reports/:id` | JWT | Один отчёт + статус |
| `GET` | `/reports/:id/download` | JWT | Скачать PDF (Redis TTL 1h, 404 если expired) |

## Gmail

См. [[gmail-module]].

| Метод | Путь | Auth | Throttle | Описание |
|-------|------|------|----------|----------|
| `GET` | `/gmail/connect` | JWT | 5/min | `{ authUrl }` Google consent URL |
| `GET` | `/gmail/callback?code=&state=` | — | — | Public OAuth callback → redirect на mobile deep link |
| `GET` | `/gmail/status` | JWT | — | Connection state + per-plan daily quota |
| `DELETE` | `/gmail/disconnect` | JWT | — | Очистка refresh token |
| `POST` | `/gmail/scan` | JWT + RequireProGuard | 2/min | Sync scan (до 1500 messages, lookback 365 days) |
| `POST` | `/gmail/scan/start` | JWT + RequireProGuard | 4/min | Async scan → `{ jobId }` |
| `GET` | `/gmail/scan/status/:jobId` | JWT | 60/min | Poll progress |

## Catalog

См. [[catalog-module]].

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| `GET` | `/catalog/popular?region=&currency=&limit=` | JWT | Топ-сервисы (edge cache когда region+currency явные) |
| `GET` | `/catalog/search?q=&region=` | JWT | Поиск (slug + alias + AI research если miss) |
| `POST` | `/catalog/seed-prices` | JWT + ADMIN_EMAILS | One-time seed regional prices |

## Payment Cards

См. [[payment-cards-module]].

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| `POST` | `/payment-cards` | JWT | Создать |
| `GET` | `/payment-cards` | JWT | Список |
| `GET` | `/payment-cards/:id` | JWT | Одна |
| `PATCH` | `/payment-cards/:id` | JWT | Partial update |
| `DELETE` | `/payment-cards/:id` | JWT | Удалить (subs.paymentCardId → NULL) |

## Receipts (standalone)

Дополнительно к `/subscriptions/:id/receipts/*` есть standalone-эндпоинт:

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| `POST` | `/receipts` | JWT | Загрузка чека (multipart `file`) с auto-link к подписке через AI parsing |
| `GET` | `/receipts` | JWT | Список receipts |
| `DELETE` | `/receipts/:id` | JWT | Удалить |

## Mobile-specific алиасы

Мобильное приложение использует некоторые специфичные эндпоинты:

| Мобильный endpoint | Делегирует к |
|-------------------|-------------|
| `POST /auth/google/mobile` | `POST /auth/google/token` |
| `POST /auth/verify { token }` | `GET /auth/magic?token=` |
| `GET /auth/profile` | `GET /auth/me` |
| `POST /auth/profile` | `PATCH /users/me` |
| `PUT /subscriptions/:id` | `PATCH /subscriptions/:id` |

Подробнее: [[auth-module]], [[subscriptions-module]], [[analytics-module]], [[ai-module]], [[billing-module]], [[workspace-module]], [[analysis-module]], [[reports-module]], [[gmail-module]], [[catalog-module]], [[payment-cards-module]]
