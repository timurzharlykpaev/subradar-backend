---
title: Модуль аутентификации (Auth)
tags: [module, auth, jwt, google, apple, magic-link, otp, guards]
sources:
  - src/auth/auth.controller.ts
  - src/auth/auth.service.ts
  - src/auth/guards/jwt-auth.guard.ts
  - src/auth/guards/google-auth.guard.ts
  - src/auth/strategies/jwt.strategy.ts
  - src/auth/dto/auth.dto.ts
  - src/auth/entities/refresh-token.entity.ts
updated: 2026-04-16
---

# Модуль аутентификации

## Стратегии аутентификации

### 1. Email + Password

- `POST /auth/register` — регистрация (bcrypt hash, 12 rounds)
- `POST /auth/login` — вход с email/password
- Rate limit: 5 req / 15 min
- Lockout: 10 неудачных попыток → блокировка на 1 час (Redis `auth:lockout:{email}`)

### 2. Google OAuth

Два flow:

**Web (OAuth popup):**
- `GET /auth/google` → redirect к Google
- `GET /auth/google/callback` → redirect на frontend с токенами в hash

**Mobile/API (access_token):**
- `POST /auth/google/token` → принимает `{ accessToken }` или `{ idToken }`
- `POST /auth/google/mobile` → alias для мобилки
- Бэкенд запрашивает Google userinfo API (`https://www.googleapis.com/oauth2/v3/userinfo`)
- Если пользователя нет — создаёт нового с `provider: 'google'`

### 3. Apple Sign-In

- `POST /auth/apple` → принимает `{ idToken, name? }`
- Верификация через `apple-signin-auth` (криптографическая проверка Apple public keys)
- `audience: 'com.goalin.subradar'` (Apple Client ID)

### 4. Magic Link

- `POST /auth/magic-link` → принимает `{ email }`
- Генерирует JWT токен (secret: `MAGIC_LINK_SECRET`, TTL: 15 минут)
- Отправляет email через Resend
- В dev-режиме возвращает ссылку в ответе
- `GET /auth/magic?token=xxx` — верификация (web)
- `POST /auth/verify` → принимает `{ token }` — верификация (mobile)
- Одноразовый: после использования `magicLinkToken` очищается

### 5. OTP (код подтверждения)

- `POST /auth/otp/send` → отправляет 6-значный код на email
- `POST /auth/otp/verify` → проверяет код
- Код хранится в Redis (TTL 15 минут)
- Lockout: 10 неудачных попыток → блокировка на 1 час
- **App Store Review:** email `review@subradar.ai` → фиксированный код `000000`

## JWT токены

| Тип | Secret env | TTL по умолчанию |
|-----|-----------|------------------|
| Access | `JWT_ACCESS_SECRET` (fallback `JWT_SECRET`) | 7 дней |
| Refresh | `JWT_REFRESH_SECRET` | 30 дней |

Payload:
```json
{ "sub": "user-uuid", "email": "user@email.com" }
```

### Refresh flow

1. Клиент отправляет `POST /auth/refresh { refreshToken }`
2. Бэкенд верифицирует JWT → находит пользователя
3. Сравнивает bcrypt-хеш refresh token (хранится в `user.refreshToken`)
4. Генерирует новую пару access + refresh
5. Обновляет хеш в БД (rotation)

### Logout

`POST /auth/logout` — очищает refreshToken в БД.

## Guards

| Guard | Используется |
|-------|-------------|
| `JwtAuthGuard` | Все защищённые эндпоинты (`@UseGuards(JwtAuthGuard)`) |
| `GoogleAuthGuard` | `GET /auth/google`, `GET /auth/google/callback` |

`@Public()` декоратор — для открытых эндпоинтов.

## Эндпоинты

| Метод | Путь | Описание | Rate limit |
|-------|------|----------|------------|
| `POST /auth/register` | Регистрация | 5/15min |
| `POST /auth/login` | Вход | 5/15min |
| `GET /auth/google` | Google OAuth redirect | |
| `GET /auth/google/callback` | Google callback | |
| `POST /auth/google/token` | Google access_token login | |
| `POST /auth/google/mobile` | Alias для мобилки | |
| `POST /auth/apple` | Apple Sign-In | |
| `POST /auth/magic-link` | Отправка magic link | 5/15min |
| `GET /auth/magic` | Верификация magic link (web) | |
| `POST /auth/verify` | Верификация magic link (mobile) | |
| `POST /auth/otp/send` | Отправка OTP | 5/15min |
| `POST /auth/otp/verify` | Верификация OTP | 5/15min |
| `POST /auth/refresh` | Обновление токенов | |
| `POST /auth/logout` | Выход | |
| `GET /auth/me` | Текущий пользователь | |
| `GET /auth/profile` | Alias /auth/me (mobile) | |
| `POST /auth/profile` | Обновление профиля (mobile) | |

## Создание пользователя

Новые пользователи всегда создаются с:
- `plan: 'free'`
- `trialUsed: false`

Подробнее: [[users-module]], [[billing-module]]
