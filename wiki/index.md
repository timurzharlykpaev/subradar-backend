# Wiki Index — SubRadar Backend

## Архитектура

- [[overview]] — Обзор проекта: стек, назначение, клиенты
- [[architecture]] — Архитектура: модули, guards, interceptors, middleware, конфигурация, state machine, outbox, idempotency, audit
- [[database]] — База данных: TypeORM, миграции, сущности, связи
- [[deploy]] — Деплой: CI/CD, переменные окружения, staging/production
- [[cron-jobs]] — Централизованный список cron / BullMQ задач + heartbeat-expectations
- [[common-cross-cutting]] — Guards, decorators, middleware, audit, idempotency, telegram alerts, AES-GCM, antivirus

## Модули (NestJS)

- [[auth-module]] — Аутентификация: Google, Apple, Magic Link, OTP, JWT, refresh tokens
- [[users-module]] — Пользователи: профиль, region, displayCurrency, настройки (timezone+dateFormat sync с мобилы)
- [[subscriptions-module]] — Подписки: CRUD, статусы, displayCurrency-конвертация, каталог
- [[payment-cards-module]] — Платёжные карты (last4, brand, nickname; для маркировки subs)
- [[billing-module]] — Биллинг: планы Free/Pro/Organization, RevenueCat, Lemon Squeezy, state machine (см. ниже submodules)
- [[analytics-module]] — Аналитика: summary, monthly, by-category, by-card, forecast, savings, FX-конвертация
- [[ai-module]] — AI gateway: wizard, voice-to-subscription, parse-screenshot, lookup, bulk-parse
- [[analysis-module]] — Глубокий AI-анализ (BullMQ, recommendations, duplicates, team overlaps)
- [[reports-module]] — PDF/CSV отчёты (Personal + Team, async через BullMQ + PDFKit)
- [[gmail-module]] — Gmail OAuth + inbox scan (Pro/Team feature, CASA-compliant)
- [[catalog-module]] — Справочник сервисов (regional prices, AI research)
- [[workspace-module]] — Team plan: workspaces, members, invites, roles, team reports
- [[fx-module]] — FX курсы: получение, кеширование, конвертация валют
- [[notifications-module]] — Уведомления: push (Expo/FCM), email (Resend), напоминания, дайджест

## Billing submodules

- [[trials]] — One-trial-per-user, UNIQUE(user_id), transactional activation
- [[effective-access]] — Резолвер плана (источник истины для `/billing/me`)
- [[reconciliation]] — Hourly post-webhook state sync с RevenueCat
- [[outbox]] — Transactional outbox для Amplitude / Telegram / FCM

## Сущности (Entities)

| Сущность | Таблица | Модуль | Страница |
|----------|---------|--------|----------|
| User | `users` | users | [[users-module]] |
| UserBilling | `user_billing` | billing | [[billing-module]] |
| UserTrial | `user_trials` | billing/trials | [[trials]] |
| Subscription | `subscriptions` | subscriptions | [[subscriptions-module]] |
| PaymentCard | `payment_cards` | payment-cards | [[payment-cards-module]] |
| RefreshToken | `refresh_tokens` | auth | [[auth-module]] |
| Receipt | `receipts` | receipts | [[subscriptions-module]] |
| Report | `reports` | reports | [[reports-module]] |
| Workspace | `workspaces` | workspace | [[workspace-module]] |
| WorkspaceMember | `workspace_members` | workspace | [[workspace-module]] |
| InviteCode | `invite_codes` | workspace | [[workspace-module]] |
| AnalysisJob | `analysis_jobs` | analysis | [[analysis-module]] |
| AnalysisResult | `analysis_results` | analysis | [[analysis-module]] |
| AnalysisUsage | `analysis_usage` | analysis | [[analysis-module]] |
| ServiceCatalog (legacy) | `service_catalog` | analysis | [[analysis-module]] |
| FxRateSnapshot | `fx_rate_snapshots` | fx | [[fx-module]] |
| CatalogService | `catalog_services` | catalog | [[catalog-module]] |
| CatalogPlan | `catalog_plans` | catalog | [[catalog-module]] |
| PushToken | `push_tokens` | notifications | [[notifications-module]] |
| SuppressedEmail | `suppressed_emails` | notifications | [[notifications-module]] |
| WebhookEvent | `webhook_events` | billing | [[billing-module]] |
| BillingDeadLetter | `billing_dead_letter` | billing | [[billing-module]] |
| OutboxEvent | `outbox_events` | billing/outbox | [[outbox]] |
| AuditLog | `audit_logs` | common | [[common-cross-cutting]] |
| IdempotencyKey | `idempotency_keys` | common | [[common-cross-cutting]] |
| KnownBillingSender | `known_billing_senders` | gmail | [[gmail-module]] |

## API Endpoints

- [[api-contracts]] — Полная карта API: auth, subscriptions, analytics, ai, billing, notifications, users, workspace, analysis, reports, gmail, catalog, payment-cards

## Интеграции

| Интеграция | Описание | Страница |
|-----------|----------|----------|
| RevenueCat | IAP/подписки iOS | [[billing-module]] / [[reconciliation]] |
| Lemon Squeezy | Веб-биллинг | [[billing-module]] |
| OpenAI (GPT-4o, gpt-4o-mini) | AI-фичи + Vision + Whisper | [[ai-module]] / [[analysis-module]] / [[catalog-module]] / [[gmail-module]] |
| Resend | Email | [[notifications-module]] |
| Expo Push | Push-уведомления | [[notifications-module]] |
| Firebase (FCM) | Push (legacy) | [[notifications-module]] |
| Gmail API | Inbox scan (Pro feature) | [[gmail-module]] |
| open.er-api.com | FX курсы (primary) | [[fx-module]] |
| frankfurter.dev | FX курсы (fallback) | [[fx-module]] |
| Amplitude | Analytics events (через outbox) | [[outbox]] |
| DigitalOcean Spaces | Файловое хранилище | [[deploy]] |
| Telegram | Алерты 5xx + cron failures | [[common-cross-cutting]] |

## Инфраструктура

- [[database]] — PostgreSQL (DO Managed), Redis, миграции
- [[deploy]] — GitHub Actions, Docker, GHCR, SSH-деплой
- [[cron-jobs]] — Schedule + BullMQ queues

## Известные проблемы

- [[known-issues]] — Текущие ограничения, нюансы, backward-compat правила (App Store live)
