# Wiki Index — SubRadar Backend

## Архитектура

- [[overview]] — Обзор проекта: стек, назначение, клиенты
- [[architecture]] — Архитектура: модули, guards, interceptors, middleware, конфигурация
- [[database]] — База данных: TypeORM, миграции, сущности, связи
- [[deploy]] — Деплой: CI/CD, переменные окружения, staging/production

## Модули (NestJS)

- [[auth-module]] — Аутентификация: Google, Apple, Magic Link, OTP, JWT, refresh tokens
- [[users-module]] — Пользователи: профиль, region, displayCurrency, настройки
- [[subscriptions-module]] — Подписки: CRUD, статусы, displayCurrency-конвертация, каталог
- [[billing-module]] — Биллинг: планы Free/Pro/Organization, RevenueCat, Lemon Squeezy, trial, grace period
- [[analytics-module]] — Аналитика: summary, monthly, by-category, by-card, forecast, savings, FX-конвертация
- [[ai-module]] — AI: wizard, voice-to-subscription, parse-screenshot, lookup, bulk-parse, каталог сервисов
- [[fx-module]] — FX курсы: получение, кеширование, конвертация валют
- [[notifications-module]] — Уведомления: push (Expo/FCM), email (Resend), напоминания, дайджест

## Сущности (Entities)

| Сущность | Таблица | Модуль | Страница |
|----------|---------|--------|----------|
| User | `users` | users | [[users-module]] |
| Subscription | `subscriptions` | subscriptions | [[subscriptions-module]] |
| PaymentCard | `payment_cards` | payment-cards | [[subscriptions-module]] |
| RefreshToken | `refresh_tokens` | auth | [[auth-module]] |
| Receipt | `receipts` | receipts | [[subscriptions-module]] |
| Report | `reports` | reports | [[analytics-module]] |
| Workspace | `workspaces` | workspace | [[billing-module]] |
| WorkspaceMember | `workspace_members` | workspace | [[billing-module]] |
| InviteCode | `invite_codes` | workspace | [[billing-module]] |
| AnalysisJob | `analysis_jobs` | analysis | [[ai-module]] |
| AnalysisResult | `analysis_results` | analysis | [[ai-module]] |
| AnalysisUsage | `analysis_usage` | analysis | [[ai-module]] |
| FxRateSnapshot | `fx_rate_snapshots` | fx | [[fx-module]] |
| CatalogService | `catalog_services` | catalog | [[ai-module]] |
| CatalogPlan | `catalog_plans` | catalog | [[ai-module]] |
| PushToken | `push_tokens` | notifications | [[notifications-module]] |

## API Endpoints

- [[api-contracts]] — Полная карта API: auth, subscriptions, analytics, ai, billing, notifications, users

## Интеграции

| Интеграция | Описание | Страница |
|-----------|----------|----------|
| RevenueCat | IAP/подписки iOS | [[billing-module]] |
| Lemon Squeezy | Веб-биллинг | [[billing-module]] |
| OpenAI (GPT-4o) | AI-фичи | [[ai-module]] |
| Resend | Email | [[notifications-module]] |
| Expo Push | Push-уведомления | [[notifications-module]] |
| Firebase (FCM) | Push (legacy) | [[notifications-module]] |
| open.er-api.com | FX курсы (primary) | [[fx-module]] |
| frankfurter.dev | FX курсы (fallback) | [[fx-module]] |
| DigitalOcean Spaces | Файловое хранилище | [[deploy]] |
| Telegram | Алерты 5xx ошибок | [[architecture]] |

## Инфраструктура

- [[database]] — PostgreSQL (DO Managed), Redis, миграции
- [[deploy]] — GitHub Actions, Docker, GHCR, SSH-деплой

## Известные проблемы

- [[known-issues]] — Текущие ограничения и нюансы
