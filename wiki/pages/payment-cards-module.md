---
title: Модуль платёжных карт (Payment Cards)
tags: [module, payment-cards, cards, link]
sources:
  - src/payment-cards/payment-cards.controller.ts
  - src/payment-cards/payment-cards.service.ts
  - src/payment-cards/payment-cards.module.ts
  - src/payment-cards/entities/payment-card.entity.ts
  - src/payment-cards/dto/create-payment-card.dto.ts
updated: 2026-05-22
---

# Модуль Payment Cards

Каталог платёжных карт пользователя для маркировки подписок (какая карта списывается). Не хранит PAN — только last4, brand, nickname, color. Не интегрирован с реальными платёжными системами; чисто organisational.

## Сущность PaymentCard (`payment_cards`)

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `userId` | UUID | FK → users (CASCADE) |
| `nickname` | string | "Halyk Gold", "Visa Tinkoff" |
| `last4` | varchar(4) | Последние 4 цифры |
| `brand` | enum | `VISA` / `MC` / `AMEX` / `MIR` / `OTHER` |
| `color` | varchar(7) | HEX (`#6366f1` default) для UI |
| `isDefault` | boolean | Default карта по умолчанию для новых subs |
| `createdAt`, `updatedAt` | timestamp | |

Связи:
- `User 1—N PaymentCard` (CASCADE delete с user)
- `Subscription N—1 PaymentCard` (SET NULL on card delete — см. [[subscriptions-module]])

## API эндпоинты

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| `POST` | `/payment-cards` | JWT | Создать карту |
| `GET` | `/payment-cards` | JWT | Список карт юзера |
| `GET` | `/payment-cards/:id` | JWT | Одна карта |
| `PATCH` | `/payment-cards/:id` | JWT | Partial update |
| `DELETE` | `/payment-cards/:id` | JWT | Удалить (subs.paymentCardId → NULL) |

## DTO

`CreatePaymentCardDto`:
```ts
{
  nickname: string;
  last4: string;          // exactly 4 digits
  brand?: CardBrand;
  color?: string;         // 7-char hex
  isDefault?: boolean;
}
```

## isDefault логика

При создании/обновлении с `isDefault: true` → все остальные карты этого user'а сбрасываются на `false` (single-default invariant).

## Использование в subscriptions

`Subscription.paymentCardId` (nullable FK). В `GET /subscriptions` подгружается через JOIN. `GET /analytics/by-card` группирует расходы по карте.

## Связанные

- [[subscriptions-module]] — потребитель FK
- [[analytics-module]] → by-card endpoint
- [[reports-module]] — PDF группирует расходы по картам
