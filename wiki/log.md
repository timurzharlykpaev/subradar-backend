# Wiki Log — SubRadar Backend

## 2026-05-22 — Major refresh

- **Добавлено** (11 новых страниц):
  - `workspace-module` — Team plan: workspaces, members, invites, roles, team reports
  - `analysis-module` — глубокий AI-анализ (BullMQ pipeline, recommendations, overlaps) — отдельно от ai-module
  - `reports-module` — PDF/CSV (Personal + Team), PDFKit, fonts, i18n, freeze fix
  - `gmail-module` — Gmail OAuth + inbox scan (Pro/Team, CASA-compliant, encrypted refresh token)
  - `catalog-module` — справочник сервисов с regional pricing + AI research
  - `trials` — One-trial-per-user (billing submodule, UNIQUE constraint, transactional activation)
  - `effective-access` — резолвер плана + TTL cache + banner priority
  - `reconciliation` — hourly RC↔local state sync
  - `outbox` — transactional outbox для Amplitude/Telegram/FCM
  - `common-cross-cutting` — guards, decorators, middleware, audit, idempotency, heartbeat, crypto, antivirus
  - `payment-cards-module` — карты для маркировки subs
  - `cron-jobs` — централизованный список cron / BullMQ задач + heartbeat-expectations
- **Обновлено**:
  - `architecture` — секция Cross-cutting patterns (State Machine, Outbox, EffectiveAccess, Idempotency, Audit, CorrelationId)
  - `billing-module` — список submodules, state machine events/states, dead letter, webhook idempotency
  - `ai-module` — переформулирован как LLM gateway; analysis/catalog вынесены в свои страницы
  - `api-contracts` — добавлены endpoints для workspace, analysis (расширено), reports, gmail, catalog, payment-cards, receipts
  - `known-issues` — добавлено правило App Store backward compat (mobile live, ~50%/нед адопшен), fix f0d2d2b (report freeze)
  - `database` — добавлены entities: UserBilling, UserTrial, WebhookEvent, BillingDeadLetter, OutboxEvent, AuditLog, IdempotencyKey, SuppressedEmail (+ обновлены связи)
  - `users-module` — fix 73c03e3 (sync timezone + dateFormat from mobile через PATCH /users/me)
  - `index` — добавлены новые страницы в категории, расширена таблица Entities, добавлены billing submodules + cross-cutting секция, обновлены интеграции
- **Причина:** за месяц добавилось много модулей — Team plan, AI analysis pipeline, Gmail scan, Reports, Catalog enrichment, billing state machine, фиксы report freeze, sync настроек с мобилы

## 2026-04-16 — Инициализация wiki

- Создана структура wiki: SCHEMA.md, index.md, log.md, pages/, sources/
- Созданы начальные страницы (14 штук):
  - overview, architecture, database, deploy
  - auth-module, users-module, subscriptions-module, billing-module
  - analytics-module, ai-module, fx-module, notifications-module
  - api-contracts, known-issues
- Источники: полный анализ src/ — все модули, entities, controllers, services
- Версия кодовой базы: текущий main branch
