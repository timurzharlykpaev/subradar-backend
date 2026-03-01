# 📋 SubRadar AI — Полное Техническое Задание

## 1. Обзор продукта

**SubRadar AI** — мобильное и веб-приложение для логирования, отслеживания и анализа подписок. Пользователь видит все свои расходы на подписки в одном месте, получает умные напоминания и налоговые отчёты.

**Стек:**
- Mobile: React Native (Expo) — `subradar-mobile`
- Backend: NestJS + PostgreSQL + Redis — `subradar-backend`
- Web: Next.js 15 (App Router) — `subradar-web`
- Инфраструктура: DigitalOcean (сервер 46.101.197.19, отдельные Docker-контейнеры)
- Домен: `subradar.io`
- Юрлицо: ТОО "GOALIN", БИН 260240021438

---

## 2. Конкурентный анализ

| Фича | Rocket Money | Bobby | **SubRadar** |
|------|-------------|-------|----------|
| AI голосовой ввод | ❌ | ❌ | ✅ |
| Распознавание скриншота | ❌ | ❌ | ✅ |
| AI поиск планов по региону | ❌ | ❌ | ✅ |
| Карта списания (last4) | ❌ | ❌ | ✅ |
| Налоговый отчёт PDF | ❌ | ❌ | ✅ |
| Загрузка чеков | ❌ | ❌ | ✅ |
| Серверы/инфра подписки | ❌ | ❌ | ✅ |
| Командный план | ❌ | ❌ | ✅ |

---

## 3. Модели данных

### 3.1 Subscription

```typescript
{
  id: uuid
  userId: uuid

  // Обязательные
  name: string                    // "Netflix", "Кинопоиск", "DigitalOcean"
  category: enum {
    STREAMING, AI_SERVICES, INFRASTRUCTURE, PRODUCTIVITY,
    MUSIC, GAMING, NEWS, HEALTH, OTHER
  }
  amount: decimal
  currency: string                // USD, EUR, RUB, KZT
  billingPeriod: enum {
    MONTHLY, YEARLY, WEEKLY, QUARTERLY, LIFETIME, ONE_TIME
  }
  billingDay: int                 // День месяца списания (1-31)
  startDate: date
  status: enum { TRIAL, ACTIVE, PAUSED, CANCELLED }

  // Необязательные
  currentPlan: string             // "Basic", "Pro", "Family"
  availablePlans: json            // [{name, price, currency, features}]
  trialEndDate: date | null
  cancelledAt: date | null
  serviceUrl: string | null
  cancelUrl: string | null        // Прямая ссылка на отмену
  managePlanUrl: string | null
  iconUrl: string | null
  iconCustom: string | null
  reminderDaysBefore: int[]       // [1, 3, 7]
  reminderEnabled: boolean
  isBusinessExpense: boolean
  taxCategory: string | null      // "Software", "Cloud", "Marketing"
  notes: string | null
  addedVia: enum { MANUAL, AI_VOICE, AI_SCREENSHOT, AI_TEXT }
  aiMetadata: json | null

  // Карта списания
  paymentCardId: uuid | null

  createdAt: timestamp
  updatedAt: timestamp
}
```

### 3.2 PaymentCard

```typescript
{
  id: uuid
  userId: uuid
  nickname: string        // "Моя Kaspi", "Рабочая Visa" — произвольное
  last4: string           // "4242"
  brand: enum { VISA, MASTERCARD, AMEX, MIR, UNIONPAY, OTHER }
  color: string | null    // hex цвет карточки в UI
  isDefault: boolean
  createdAt: timestamp
}
```

### 3.3 User

```typescript
{
  id: uuid
  email: string
  googleId: string | null
  appleId: string | null
  nickname: string | null
  avatarUrl: string | null
  locale: string          // ru, en, kz
  timezone: string
  defaultCurrency: string
  country: string
  sublogPlan: enum { FREE, PRO, TEAM }
  sublogPlanExpiresAt: date | null
  lemonSqueezyCustomerId: string | null
  workspaceId: uuid | null
  createdAt: timestamp
}
```

### 3.4 Workspace (Team план)

```typescript
{
  id: uuid
  name: string
  ownerId: uuid
  plan: enum { TEAM }
  maxMembers: int         // 5
  lemonSqueezySubscriptionId: string | null
  createdAt: timestamp
}
```

### 3.5 WorkspaceMember

```typescript
{
  id: uuid
  workspaceId: uuid
  userId: uuid
  role: enum { OWNER, ADMIN, MEMBER }
  inviteEmail: string | null
  status: enum { PENDING, ACTIVE }
  joinedAt: timestamp
}
```

### 3.6 Receipt

```typescript
{
  id: uuid
  subscriptionId: uuid
  userId: uuid
  fileUrl: string         // DO Spaces URL
  fileName: string
  fileSize: int
  mimeType: string
  amount: decimal | null  // AI распознал
  date: date | null
  currency: string | null
  rawText: string | null
  createdAt: timestamp
}
```

---

## 4. API Endpoints

### Auth
```
POST /auth/google
POST /auth/apple
POST /auth/magic-link
POST /auth/refresh
POST /auth/logout
GET  /auth/me
PATCH /auth/me
DELETE /auth/me
```

### Subscriptions
```
GET    /subscriptions
POST   /subscriptions
GET    /subscriptions/:id
PATCH  /subscriptions/:id
DELETE /subscriptions/:id
POST   /subscriptions/:id/cancel
POST   /subscriptions/:id/pause
POST   /subscriptions/:id/restore
```

### Payment Cards
```
GET    /payment-cards
POST   /payment-cards
PATCH  /payment-cards/:id
DELETE /payment-cards/:id
PATCH  /payment-cards/:id/set-default
```

### AI
```
POST /ai/lookup-service
  body: { query, locale, country }
  → { name, iconUrl, plans[], cancelUrl, serviceUrl, category }

POST /ai/parse-screenshot
  body: { imageBase64 }
  → { name, amount, currency, billingPeriod, date, planName }

POST /ai/voice-to-subscription
  body: { audioBase64, locale }
  → subscription fields

GET  /ai/suggest-cancel-url
  query: { serviceName, serviceUrl }
  → { cancelUrl, steps[] }
```

### Analytics
```
GET /analytics/summary?month&year
GET /analytics/monthly?months=12
GET /analytics/by-category?month&year
GET /analytics/upcoming?days=7
GET /analytics/by-card
```

### Reports
```
POST /reports/generate
  body: { from, to, type: 'summary'|'detailed'|'tax' }
GET  /reports/:id/download   → PDF stream
GET  /reports
```

### Receipts
```
POST   /receipts             (multipart, subscriptionId)
GET    /receipts?subscriptionId=
DELETE /receipts/:id
```

### Workspace (Team)
```
POST   /workspace                    — создать workspace
GET    /workspace                    — мой workspace
PATCH  /workspace                    — переименовать
POST   /workspace/invite             — пригласить по email
GET    /workspace/members            — список участников
DELETE /workspace/members/:userId    — удалить участника
PATCH  /workspace/members/:userId/role
GET    /workspace/analytics          — общая аналитика команды
POST   /workspace/reports/generate   — командный PDF
```

### Billing
```
GET  /billing/plans
POST /billing/checkout        → { checkoutUrl }
GET  /billing/me
POST /billing/webhook         (Lemon Squeezy HMAC)
POST /billing/cancel
```

### Notifications
```
GET   /notifications
PATCH /notifications/settings
POST  /notifications/push-token   — регистрация FCM токена
```

---

## 5. Монетизация

| | Free | Pro | Team |
|---|---|---|---|
| Подписок | до 5 | ∞ | ∞ |
| AI-фичи | ❌ | ✅ | ✅ |
| Распознавание фото | ❌ | ✅ | ✅ |
| Аналитика | базовая | полная | командная |
| Налоговый отчёт PDF | ❌ | ✅ | ✅ |
| Хранение чеков | ❌ | ✅ 5GB | ✅ 20GB |
| Участников | 1 | 1 | до 5 |
| Цена | $0 | $2.99/мес или $24.99/год | $9.99/мес |

Оплата: **Lemon Squeezy** (Merchant of Record)

---

## 6. AI Implementation

**Модель:** GPT-4o (vision для скриншотов)

**lookup-service промпт:**
```
Пользователь хочет добавить подписку: "{query}".
Страна: {country}, язык: {locale}.
Найди и верни JSON:
{
  name, iconUrl, serviceUrl, cancelUrl, category,
  plans: [{ name, price, currency, period, features }]
}
```

**parse-screenshot промпт:**
```
Это скриншот чека/уведомления об оплате подписки.
Извлеки: название, сумму, валюту, период, дату, план.
Верни только JSON.
```

---

## 7. Инфраструктура

```yaml
# docker-compose.subradar.yml
services:
  subradar-api-prod:
    ports: ["3100:3000"]
    env_file: /opt/subradar/.env.prod

  subradar-api-dev:
    ports: ["3101:3000"]
    env_file: /opt/subradar/.env.dev

  subradar-db:
    image: postgres:16

  subradar-redis:
    image: redis:7-alpine
```

**Домены:**
- `subradar.io` → лендинг (статика)
- `app.subradar.io` → Next.js SPA
- `api.subradar.io` → NestJS prod (3100)
- `api-dev.subradar.io` → NestJS dev (3101)

**DO Spaces:** хранение чеков и иконок (bucket: subradar)

---

## 8. Онбординг (лендинг subradar.io)

- Hero: "Знаешь ли ты сколько тратишь на подписки?"
- Демо: голосовой ввод → AI находит сервис → карточка подписки
- Фичи: скриншот→автодобавление, напоминания, аналитика, налоговый отчёт, карты
- Pricing: Free / Pro / Team
- CTA: App Store / Google Play / Open Web App

---

## 9. Безопасность

- JWT + Refresh tokens (rotate)
- Helmet, Rate limiting, CORS
- DO Spaces signed URLs для чеков (приватные)
- GDPR: экспорт + полное удаление данных
- Lemon Squeezy webhooks — HMAC верификация

---

## 10. Следующие шаги

1. DNS в Spaceship (5 A-записей → 46.101.197.19)
2. SSL certbot
3. Docker deploy backend
4. Deploy web → app.subradar.io
5. Заполнить .env.prod
6. Workspace/Team модуль (следующая итерация)
7. App Store + Google Play публикация
