---
title: Обзор проекта SubRadar Backend
tags: [overview, project, architecture]
sources:
  - src/main.ts
  - src/app.module.ts
  - CLAUDE.md
  - README.md
updated: 2026-04-16
---

# Обзор проекта

## Что это

SubRadar AI — NestJS-бэкенд для SaaS-платформы отслеживания подписок с AI-возможностями.

Обслуживает два клиента:
- **Мобильное приложение** (React Native + Expo) — iOS/Android
- **Веб-приложение** (React) — `app.subradar.ai`

## Стек

| Компонент | Технология |
|-----------|-----------|
| Фреймворк | NestJS + TypeScript (strict) |
| ORM | TypeORM |
| БД | PostgreSQL (DigitalOcean Managed) |
| Кеш/Очереди | Redis + BullMQ |
| AI | OpenAI GPT-4o (gpt-4o) |
| Email | Resend |
| Push | Expo Push SDK + Firebase Admin |
| Биллинг (мобилка) | RevenueCat (Apple IAP) |
| Биллинг (веб) | Lemon Squeezy |
| Хранилище файлов | DigitalOcean Spaces |
| Безопасность | Helmet, Throttler (300 req/min) |
| Документация | Swagger (только dev) |

## URL

| Среда | URL | Контейнер | Порт |
|-------|-----|-----------|------|
| Production | `https://api.subradar.ai/api/v1` | `subradar-api-prod` | 8082 |
| Development | `https://api-dev.subradar.ai/api/v1` | `subradar-api-dev` | 8083 |
| Swagger (dev) | `http://localhost:3000/api/docs` | — | 3000 |

## Глобальный префикс

Все API-эндпоинты имеют префикс `/api/v1`:

```typescript
app.setGlobalPrefix('api/v1');
```

## Ключевые возможности

1. **Управление подписками** — CRUD, статусы, категории, привязка к картам
2. **AI-добавление** — голосовой ввод (Whisper), скриншот (GPT-4o Vision), текстовый поиск, wizard-диалог
3. **Аналитика** — summary, тренды, по категориям, по картам, forecast, savings
4. **Мультивалютность** — displayCurrency конвертация через live FX-курсы
5. **Биллинг** — Free/Pro/Organization планы, RevenueCat + Lemon Squeezy
6. **Уведомления** — push-напоминания, email-дайджесты, trial/expiration alerts
7. **Workspace** — организации с ролями Owner/Admin/Member
8. **AI-анализ** — глубокий анализ подписок с рекомендациями (BullMQ jobs)

## Смежные репозитории

| Репо | Описание |
|------|---------|
| `subradar-mobile` | React Native мобильное приложение |
| `subradar-web` | React веб-приложение |
| `subradar-landing` | Лендинг subradar.ai |

Подробнее: [[architecture]], [[database]], [[deploy]]
