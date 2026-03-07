# PROGRESS.md — subradar-backend

_Обновляй этот файл после каждой завершённой фичи или фикса._

---

## ✅ Завершено

### Инфраструктура
- [x] NestJS + TypeScript strict
- [x] TypeORM + PostgreSQL (DO Managed, SSL)
- [x] JWT auth с refresh token rotation
- [x] Helmet, Throttler (120/min), CORS whitelist
- [x] `forbidNonWhitelisted: true` глобально
- [x] `synchronize: false` в prod, `migrationsRun: true`
- [x] Baseline миграция `InitialSchema1740873600000`
- [x] Redis + BullMQ
- [x] Docker compose: prod (8082) + dev (8083)
- [x] CI/CD GitHub Actions (dev → dev, main → prod)
- [x] GHCR push через PAT (`GHCR_TOKEN` secret)
- [x] Healthcheck через `/api/v1/auth/me` (401 = alive)

### Модули
- [x] Auth: Google OAuth (access_token → userinfo API), Magic Link, JWT refresh
- [x] Users: профиль
- [x] Subscriptions: CRUD, поиск, категории
- [x] Payment Cards: CRUD
- [x] Analytics: сводка, по категориям, по месяцам
- [x] Reports: генерация PDF/CSV
- [x] Workspace: создание, участники
- [x] Billing: планы (Free, Pro, Team)
- [x] Receipts: загрузка и хранение чеков
- [x] AI: анализ подписок, рекомендации (OpenAI)
- [x] Notifications: email через Resend (magic link)
- [x] Storage: файлы

### Email
- [x] Resend интеграция (`RESEND_API_KEY`)
- [x] SPF, DMARC, DKIM DNS записи для subradar.ai
- [x] Magic link отправка

### Безопасность
- [x] Rate limiting (global 120/min)
- [x] Helmet security headers
- [x] CORS whitelist через `CORS_ORIGINS` env
- [x] JWT секреты обязательны

### Мониторинг
- [x] Prometheus метрики (порт 8082/8083)
- [x] Grafana dashboard (subradar-overview)
- [x] Telegram alerts
- [x] Error monitor `/opt/subradar/autofix/error-monitor.py`

---

## 🚧 В работе

_(ничего активного)_

---

## MVP Acceptance Criteria (из новой спецификации)

- [x] Пользователь может войти через Google
- [x] Пользователь может добавить подписку вручную
- [ ] Пользователь может пройти onboarding
- [ ] Пользователь может добавить подписку через AI text
- [ ] Пользователь может добавить подписку через фото/скриншот
- [ ] Пользователь может подтвердить или исправить AI-результат
- [x] Пользователь видит список подписок
- [ ] Пользователь видит home dashboard (GET /analytics/home)
- [ ] Пользователь видит upcoming charges (GET /analytics/upcoming)
- [ ] Пользователь видит trial countdown (GET /analytics/trials)
- [ ] Пользователь получает пуши за 7 дней и за 1 день до списания
- [ ] Пользователь видит monthly и yearly forecast (GET /analytics/forecast)
- [x] Пользователь может сохранить card nickname + last4
- [ ] Пользователь может сгенерировать PDF summary
- [ ] Free limits и Pro gating работают корректно
- [ ] Аналитика обновляется после добавления/редактирования подписки
- [ ] Duplicate warning работает хотя бы на базовом уровне
- [x] Нет хранения чувствительных карточных данных
- [ ] Даты и уведомления работают с timezone
- [ ] Ошибки AI не ломают сценарий добавления

## Backlog

- [ ] Magic link end-to-end тест (email доставка не проверена)
- [ ] Lemon Squeezy webhook signature verification
- [ ] AI text parser (POST /ai/parse-text-subscription)
- [ ] AI screenshot parser (POST /ai/parse-subscription-image)
- [ ] AI service matcher (POST /ai/match-service)
- [ ] AI insights endpoint (GET /ai/subscription-insights)
- [ ] AI monthly audit (POST /ai/run-audit)
- [ ] Granular analytics endpoints (home, trends, categories, upcoming, trials, forecast, savings)
- [ ] Push notifications via FCM (upcoming payments, trial expiry)
- [ ] Daily cron job (billing reminders, trial alerts)
- [ ] Monthly audit cron job
- [ ] Async PDF report generation (BullMQ)
- [ ] ARCHIVED subscription status
- [ ] Subscription archive/pause/restore endpoints
- [ ] New subscription fields: normalizedServiceId, sourceType, aiConfidence, tags, reminderOffsets
- [ ] Files/attachments module (temp screenshot storage)
- [ ] Audit/logs module (event history)
- [ ] Unit тесты (покрытие низкое)
- [ ] COOP header для app.subradar.ai
