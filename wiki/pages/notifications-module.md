---
title: Модуль уведомлений (Notifications)
tags: [module, notifications, push, email, reminders, cron, digest, expo, fcm, resend]
sources:
  - src/notifications/notifications.service.ts
  - src/notifications/notifications.controller.ts
  - src/notifications/notifications.processor.ts
  - src/notifications/email-templates.ts
  - src/notifications/unsubscribe.controller.ts
  - src/reminders/reminders.service.ts
  - src/reminders/monthly-report.service.ts
updated: 2026-04-16
---

# Модуль уведомлений

## Каналы доставки

### 1. Push-уведомления

**Провайдеры:**
- **Expo Push** (primary) — для Expo Push Tokens (`ExponentPushToken[xxx]`)
- **Firebase Admin** (legacy) — для нативных FCM/APNs токенов

Логика маршрутизации:
```typescript
if (Expo.isExpoPushToken(token)) {
  // Expo SDK
} else {
  // Firebase Admin
}
```

**Регистрация токена:**
`POST /notifications/push-token { token, platform? }` → сохраняет в `user.fcmToken`.

### 2. Email

**Провайдер:** Resend (`RESEND_API_KEY`)
**From:** `noreply@subradar.ai` (настраивается через `RESEND_FROM_EMAIL`)

Если `RESEND_API_KEY` не настроен — email не отправляется (warn в логах).

**Шаблоны:**
- Payment reminder — `buildPaymentReminderHtml()`
- Weekly digest — `buildWeeklyDigestHtml()`
- Magic link — inline HTML в `auth.service.ts`
- OTP code — inline HTML в `auth.service.ts`
- Pro expiration — inline HTML в `reminders.service.ts`

## API эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| `POST /notifications/push-token` | Регистрация push-токена | `{ token, platform? }` |
| `GET /notifications/settings` | Получение настроек уведомлений | |
| `PUT /notifications/settings` | Обновление настроек | `{ enabled?, daysBefore?, emailNotifications?, weeklyDigestEnabled? }` |
| `POST /notifications/test` | Тестовое уведомление | `{ title, message }` |

## Unsubscribe

`GET /unsubscribe?uid={userId}&type={type}&sig={signature}`
- Подписанный URL (HMAC через `JWT_ACCESS_SECRET`)
- `type`: `weekly_digest`
- Отключает `weeklyDigestEnabled` для пользователя
- Используется в `List-Unsubscribe` header email-дайджестов

## Cron Jobs (RemindersService)

### Ежедневные напоминания о списаниях

`@Cron('0 9 * * *')` — 9:00 UTC

1. Находит активные подписки с `nextPaymentDate` в ближайшие 7 дней
2. Для каждой проверяет `reminderDaysBefore` (по умолчанию [1, 3])
3. Если сегодня совпадает с одним из reminder days:
   - Email (если `emailNotifications !== false`)
   - Push (если `fcmToken` есть)

### Trial expiry reminders

`@Cron('0 10 * * *')` — 10:00 UTC

- Находит Pro-пользователей с trial (без LS customer)
- Отправляет push за 1 и 4 дня до окончания

### Pro expiration reminders

`@Cron('0 10 * * *')` — 10:00 UTC

- Для пользователей с `cancelAtPeriodEnd = true`
- Push: за 7, 3, 1 день и в день истечения
- Email: только за 7 дней
- Deep link: `/paywall`

### Weekly push digest

`@Cron('0 11 * * 0')` — воскресенье 11:00 UTC

- Пользователи с `fcmToken + notificationsEnabled + weeklyDigestEnabled`
- Содержит: total monthly spend, количество renewals на неделю
- Deep link: `/(tabs)`

### Trial expiry cron

`@Cron('0 * * * *')` — каждый час

- Находит Pro-пользователей с истёкшим trial (без LS)
- Даунгрейдит до free

### Win-back push

`@Cron('0 14 * * *')` — 14:00 UTC

- Пользователи неактивные 7+ дней (proxy: `updatedAt < 7 days ago`)
- Проверяет наличие upcoming renewals
- Отправляет push с напоминанием

## BullMQ Queue

Queue: `notifications`

Job `send-reminder`:
- Обрабатывается `NotificationsProcessor`
- Retry: 3 attempts
- Может иметь delay (для отложенных уведомлений)

## Weekly Email Digest (Analysis-based)

Отправляется через `NotificationsService.sendWeeklyDigest()`:
- Основан на результатах `AnalysisResult`
- Содержит: summary, savings, рекомендации
- `List-Unsubscribe` header для one-click unsubscribe
- Подписанный unsubscribe URL

Подробнее: [[auth-module]], [[billing-module]], [[users-module]]
