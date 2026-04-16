---
title: Деплой и инфраструктура
tags: [deploy, ci-cd, github-actions, docker, environment, server]
sources:
  - .github/workflows/deploy.yml
  - .github/workflows/bootstrap-dev-migrations.yml
  - .github/workflows/diagnose.yml
  - Dockerfile
  - docker-compose.subradar.yml
  - CLAUDE.md
updated: 2026-04-16
---

# Деплой и инфраструктура

## Сервер

| Параметр | Значение |
|----------|---------|
| IP | `46.101.197.19` |
| Провайдер | DigitalOcean Droplet |
| OS | Ubuntu |
| SSH user | `root` |
| SSH key | `~/.ssh/id_steptogoal` |
| Директория | `/opt/subradar/` |

## Контейнеры

| Контейнер | Образ | Env file | Порт (хост) | Порт (контейнер) |
|-----------|-------|----------|-------------|-----------------|
| `subradar-api-prod` | `ghcr.io/.../subradar-backend:latest` | `.env.prod` | 8082 | 8080 |
| `subradar-api-dev` | `ghcr.io/.../subradar-backend:dev` | `.env.dev` | 8083 | 8080 |
| `subradar-redis` | redis | — | 6379 | 6379 |

## CI/CD (GitHub Actions)

### Workflow: Deploy

Файл: `.github/workflows/deploy.yml`

**Триггеры:**
- Push в `dev` → deploy dev
- Push в `main` → deploy prod
- Manual dispatch → выбор dev/prod

**Шаги:**
1. Checkout
2. Docker buildx setup
3. Login в GHCR (`ghcr.io/timurzharlykpaev/subradar-backend`)
4. Build & push Docker image
5. SSH → записать .env файл на сервер
6. SSH → pull image + recreate container

**Секреты:**
- `GHCR_TOKEN` — токен для GitHub Container Registry
- `SSH_PRIVATE_KEY` — SSH ключ для доступа к серверу
- `DATABASE_URL`, `DB_PASSWORD` — PostgreSQL
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — JWT
- `OPENAI_API_KEY` — OpenAI
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth
- `RESEND_API_KEY` — Email
- `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_API_KEY` — RevenueCat
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` — Push
- `LEMON_SQUEEZY_*` — Lemon Squeezy (4 variant IDs + API key + webhook secret + store ID)
- `DO_SPACES_KEY`, `DO_SPACES_SECRET` — DigitalOcean Spaces

### Workflow: Bootstrap Dev Migrations

Файл: `.github/workflows/bootstrap-dev-migrations.yml`
- Manual dispatch
- Для инициализации dev-базы с нуля

### Workflow: Diagnose

Файл: `.github/workflows/diagnose.yml`
- Диагностика состояния серверов

## Git Workflow

```
dev   → auto-deploy dev (api-dev.subradar.ai)
main  → auto-deploy prod (api.subradar.ai)
```

Процесс:
1. `git checkout dev && git pull`
2. `git checkout -b feat/xxx`
3. Работа над фичей
4. `git checkout dev && git merge feat/xxx`
5. `git push origin dev` → auto-deploy dev
6. Тестирование на dev
7. `git checkout main && git merge dev`
8. `git push origin main` → auto-deploy prod

## Переменные окружения

### Обязательные

| Переменная | Описание |
|-----------|---------|
| `NODE_ENV` | `production` / `development` |
| `PORT` | Порт приложения (8080 в контейнере) |
| `DATABASE_URL` | PostgreSQL connection string |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` | Альтернатива DATABASE_URL |
| `REDIS_URL` | Redis connection string |
| `JWT_ACCESS_SECRET` | Secret для access token |
| `JWT_REFRESH_SECRET` | Secret для refresh token |
| `OPENAI_API_KEY` | OpenAI API ключ |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `RESEND_API_KEY` | Resend email API ключ |

### Опциональные

| Переменная | Default | Описание |
|-----------|---------|---------|
| `JWT_EXPIRES_IN` | `7d` | TTL access token |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | TTL refresh token |
| `OPENAI_MODEL` | `gpt-4o` | Модель OpenAI |
| `CORS_ORIGINS` | `https://app.subradar.ai` | Разрешённые origins (через запятую) |
| `APP_URL` | `https://app.subradar.ai` | URL фронтенда |
| `FRONTEND_URL` | `https://app.subradar.ai` | URL для redirect после OAuth |
| `MAGIC_LINK_SECRET` | — | Secret для magic link JWT |
| `REVENUECAT_WEBHOOK_SECRET` | — | Секрет RevenueCat webhook |
| `REVENUECAT_API_KEY` | — | RevenueCat REST API key |
| `LEMON_SQUEEZY_API_KEY` | — | LS API key |
| `LEMON_SQUEEZY_WEBHOOK_SECRET` | — | LS webhook HMAC secret |
| `LEMON_SQUEEZY_STORE_ID` | — | LS store ID |
| `FIREBASE_PROJECT_ID` | — | Firebase для push |
| `FIREBASE_CLIENT_EMAIL` | — | Firebase |
| `FIREBASE_PRIVATE_KEY` | — | Firebase |
| `DO_SPACES_*` | — | DigitalOcean Spaces (file storage) |
| `NODE_TLS_REJECT_UNAUTHORIZED` | — | `0` для DO PostgreSQL |

## Docker

```dockerfile
# Dockerfile — multi-stage build
FROM node:20-alpine AS builder
# ... install, build
FROM node:20-alpine
# ... copy dist, run
```

## Миграции при деплое

Миграции запускаются автоматически при старте приложения (`migrationsRun: true`).
Порядок деплоя: push → build image → pull on server → recreate container → app starts → migrations run.

Подробнее: [[architecture]], [[database]]
