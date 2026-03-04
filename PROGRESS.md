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

## 📋 Бэклог

- [ ] Magic link end-to-end тест (email доставка не проверена)
- [ ] Webhook signature verify для будущих payment providers
- [ ] Расширенный AI анализ (паттерны трат, дубли подписок)
- [ ] Push уведомления (upcoming payments)
- [ ] Unit тесты (покрытие низкое)
- [ ] COOP header для app.subradar.ai
