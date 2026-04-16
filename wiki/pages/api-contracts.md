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
  - docs/API_CONTRACTS.md
updated: 2026-04-16
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

| Метод | Путь | Auth | Body | Описание |
|-------|------|------|------|----------|
| `POST` | `/analysis/run` | JWT | `{ triggerType?, workspaceId?, locale? }` | Запуск анализа |
| `GET` | `/analysis/latest` | JWT | `?workspaceId` | Последний результат |
| `GET` | `/analysis/job/:id` | JWT | — | Статус job |
| `GET` | `/analysis/usage` | JWT | — | Статистика использования |

## Mobile-specific алиасы

Мобильное приложение использует некоторые специфичные эндпоинты:

| Мобильный endpoint | Делегирует к |
|-------------------|-------------|
| `POST /auth/google/mobile` | `POST /auth/google/token` |
| `POST /auth/verify { token }` | `GET /auth/magic?token=` |
| `GET /auth/profile` | `GET /auth/me` |
| `POST /auth/profile` | `PATCH /users/me` |
| `PUT /subscriptions/:id` | `PATCH /subscriptions/:id` |

Подробнее: [[auth-module]], [[subscriptions-module]], [[analytics-module]], [[ai-module]], [[billing-module]]
