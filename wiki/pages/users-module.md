---
title: Модуль пользователей (Users)
tags: [module, users, profile, region, displayCurrency, preferences]
sources:
  - src/users/users.service.ts
  - src/users/users.controller.ts
  - src/users/entities/user.entity.ts
  - src/users/dto/update-user.dto.ts
updated: 2026-04-16
---

# Модуль пользователей

## Сущность User

Таблица: `users`

### Идентификация

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `email` | string | Уникальный |
| `name` | string | Имя (nullable) |
| `password` | string | Bcrypt-хеш (nullable, `select: false`) |
| `avatarUrl` | string | URL аватара (nullable) |
| `provider` | enum | `local` / `google` / `apple` |
| `providerId` | string | ID у OAuth-провайдера (nullable) |

### Биллинг

| Поле | Тип | Описание |
|------|-----|----------|
| `plan` | string | `free` / `pro` / `organization` |
| `billingPeriod` | string | `monthly` / `yearly` / null |
| `billingSource` | string | `revenuecat` / `lemon_squeezy` / null |
| `lemonSqueezyCustomerId` | string | LS customer ID |
| `trialUsed` | boolean | Был ли использован trial |
| `trialStartDate` | timestamp | Начало trial |
| `trialEndDate` | timestamp | Конец trial |
| `cancelAtPeriodEnd` | boolean | Подписка отменена, но активна до конца периода |
| `currentPeriodEnd` | timestamp | Конец текущего оплаченного периода |
| `downgradedAt` | timestamp | Когда был даунгрейд |
| `gracePeriodEnd` | timestamp | Конец grace period |
| `gracePeriodReason` | varchar(20) | `team_expired` / `pro_expired` / null |
| `billingIssueAt` | timestamp | Проблема с оплатой (Apple retry) |

### AI

| Поле | Тип | Описание |
|------|-----|----------|
| `aiRequestsUsed` | int | Использовано AI запросов в текущем месяце |
| `aiRequestsMonth` | string | Месяц счётчика (формат `YYYY-MM`) |

### Регион и валюта

| Поле | Тип | Описание |
|------|-----|----------|
| `region` | varchar(2) | ISO 3166-1 alpha-2 код страны (default: `US`) |
| `displayCurrency` | varchar(3) | Валюта отображения (default: `USD`) |
| `timezoneDetected` | varchar(64) | Автоопределённый timezone (nullable) |
| `defaultCurrency` | string | Устаревшее поле (legacy, nullable) |
| `timezone` | string | Timezone из настроек |
| `locale` | string | Локаль (ru, en, etc.) |
| `country` | string | Страна (legacy) |
| `dateFormat` | string | Формат даты |

### Уведомления

| Поле | Тип | Описание |
|------|-----|----------|
| `fcmToken` | string | Push-токен (Expo/FCM) |
| `notificationsEnabled` | boolean | Глобальный switch (default: true) |
| `emailNotifications` | boolean | Email-уведомления (default: true) |
| `weeklyDigestEnabled` | boolean | Еженедельный дайджест (default: true) |
| `reminderDaysBefore` | int | За сколько дней напоминать (default: 3) |

### Прочее

| Поле | Тип | Описание |
|------|-----|----------|
| `onboardingCompleted` | boolean | Прошёл онбординг |
| `proInviteeEmail` | string | Email приглашённого по Pro invite |
| `refreshToken` | string | Bcrypt-хеш refresh token |
| `magicLinkToken` | string | Текущий magic link token |
| `magicLinkExpiry` | Date | Срок magic link |

### Связи

- `OneToMany → Subscription` (cascade delete)
- `OneToMany → PaymentCard` (cascade delete)

## API эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| `GET /users/me` | Текущий пользователь | |
| `PATCH /users/me` | Обновление профиля | `{ name, avatarUrl, fcmToken, region, displayCurrency, timezoneDetected }` |
| `DELETE /users/me` | Удаление аккаунта | Каскадно удаляет все данные |
| `PATCH /users/preferences` | Обновление настроек | `{ timezone, locale, dateFormat, notificationsEnabled, currency, country }` |

### PATCH /users/me — нормализация

- `region` → `.toUpperCase()` (e.g. `"kz"` → `"KZ"`)
- `displayCurrency` → `.toUpperCase()` (e.g. `"kzt"` → `"KZT"`)

### Whitelist обновления

`UsersService.update()` использует whitelist разрешённых полей:
```
name, avatarUrl, fcmToken, refreshToken, magicLinkToken, magicLinkExpiry,
lemonSqueezyCustomerId, plan, billingSource, billingPeriod, trialUsed,
trialStartDate, trialEndDate, aiRequestsUsed, aiRequestsMonth,
proInviteeEmail, isActive, timezone, locale, country, defaultCurrency,
dateFormat, onboardingCompleted, notificationsEnabled, emailNotifications,
reminderDaysBefore, weeklyDigestEnabled, cancelAtPeriodEnd, currentPeriodEnd,
status, downgradedAt, gracePeriodEnd, gracePeriodReason, billingIssueAt
```

**Важно:** `region` и `displayCurrency` НЕ в whitelist `UsersService.update()` — они обновляются напрямую через controller. Если нужно обновить их программно, необходимо добавить в whitelist.

## Удаление аккаунта

`DELETE /users/me` → `deleteAccount(id)`:
1. Удаляет related data без CASCADE: analysis_jobs, analysis_results, analysis_usage, workspace_members, workspaces, invite_codes
2. User delete → CASCADE удаляет: subscriptions, payment_cards, receipts, reports, refresh_tokens

Подробнее: [[auth-module]], [[billing-module]], [[subscriptions-module]]
