<!-- SHARED: subradar-backend, subradar-web, subradar-mobile -->
<!-- Canonical: subradar-backend/docs/API_CONTRACTS.md -->
<!-- Synced: 2026-03-07 -->

# SubRadar AI — API Contracts

Base URL: `https://api.subradar.ai/api/v1`
Dev URL: `https://api-dev.subradar.ai/api/v1`

All endpoints require `Authorization: Bearer <access_token>` unless marked as public.

---

## Auth

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/auth/google` | Web Google login (access_token flow) | Public |
| POST | `/auth/google/mobile` | Mobile Google login | Public |
| POST | `/auth/apple` | Apple Sign-In (mobile only) | Public |
| POST | `/auth/magic-link` | Send magic link email | Public |
| POST | `/auth/magic-link/verify` | Verify magic link token | Public |
| POST | `/auth/refresh` | Refresh access token | Public (refresh_token) |
| POST | `/auth/logout` | Invalidate session | Yes |
| GET | `/auth/me` | Get current user profile | Yes |

## Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users/me` | Get user profile |
| PATCH | `/users/me` | Update user profile |
| PATCH | `/users/preferences` | Update preferences (currency, timezone, locale) |

## Subscriptions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/subscriptions` | List user subscriptions (supports filters, sorting, search) |
| POST | `/subscriptions` | Create subscription |
| GET | `/subscriptions/:id` | Get subscription detail |
| PATCH | `/subscriptions/:id` | Update subscription |
| DELETE | `/subscriptions/:id` | Delete subscription |
| POST | `/subscriptions/:id/archive` | Archive subscription |
| POST | `/subscriptions/:id/pause` | Pause subscription |
| POST | `/subscriptions/:id/restore` | Restore paused/cancelled subscription |

### Query params for GET /subscriptions
- `status` — ACTIVE, TRIAL, PAUSED, CANCELLED, ARCHIVED
- `category` — STREAMING, AI_SERVICES, etc.
- `search` — search by name, tags, category
- `sort` — nextBillingDate, amount, name, createdAt
- `order` — asc, desc
- `billingPeriod` — MONTHLY, YEARLY, etc.
- `paymentCardId` — filter by card

## AI

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/ai/parse-text-subscription` | Parse subscription from text input |
| POST | `/ai/parse-subscription-image` | Parse subscription from photo/screenshot |
| POST | `/ai/match-service` | Match service name to known services |
| GET | `/ai/subscription-insights` | Get AI insights for user's subscriptions |
| POST | `/ai/run-audit` | Trigger monthly AI audit |

### POST /ai/parse-text-subscription
```json
Request: { "text": "ChatGPT Plus $20/month, billing on 15th" }
Response: {
  "confidence": 0.92,
  "parsed": {
    "name": "ChatGPT Plus",
    "amount": 20,
    "currency": "USD",
    "billingPeriod": "MONTHLY",
    "nextBillingDate": "2026-03-15",
    "category": "AI_SERVICES",
    "status": "ACTIVE"
  },
  "clarificationNeeded": false,
  "questions": []
}
```

### POST /ai/parse-subscription-image
```
Request: multipart/form-data { image: File }
Response: same shape as parse-text-subscription
```

## Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/analytics/home` | Home dashboard data (total spend, delta, summary) |
| GET | `/analytics/trends` | Spending trends by month |
| GET | `/analytics/categories` | Category distribution breakdown |
| GET | `/analytics/upcoming` | Upcoming charges (next 30 days) |
| GET | `/analytics/trials` | Trials ending soon |
| GET | `/analytics/forecast` | Forecast for 30d / 6mo / 12mo |
| GET | `/analytics/savings` | Potential savings, duplicates, overlap |

## Cards

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cards` | List user payment cards |
| POST | `/cards` | Add payment card (nickname, last4, brand) |
| PATCH | `/cards/:id` | Update card |
| DELETE | `/cards/:id` | Delete card |

## Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/reports` | List generated reports |
| POST | `/reports` | Request new report (async generation) |
| GET | `/reports/:id` | Get report status/details |
| GET | `/reports/:id/download` | Download PDF |

### POST /reports
```json
Request: {
  "type": "SUMMARY" | "DETAILED" | "AUDIT" | "TAX",
  "period": "2026-02"
}
Response: { "id": "uuid", "status": "PENDING" }
```

## Receipts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/subscriptions/:id/receipts` | List receipts for subscription |
| POST | `/subscriptions/:id/receipts` | Upload receipt (multipart) |
| DELETE | `/receipts/:id` | Delete receipt |

## Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/notifications/push-token` | Register push token (FCM) |
| PATCH | `/notifications/settings` | Update notification preferences |

## Billing

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/billing/plans` | Get available plans (Free, Pro, Team) |
| POST | `/billing/checkout` | Create checkout session (Lemon Squeezy) |
| GET | `/billing/me` | Get current billing status |
| POST | `/billing/webhook` | Lemon Squeezy webhook (public, verified) |

## Workspace

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/workspace` | Create workspace |
| GET | `/workspace/me` | Get user's workspace |
| GET | `/workspace/members` | List workspace members |
| POST | `/workspace/invite` | Invite member |
| PATCH | `/workspace/member/:id` | Update member role |
| DELETE | `/workspace/member/:id` | Remove member |
| GET | `/workspace/analytics` | Team analytics |
| POST | `/workspace/reports` | Generate team report |
