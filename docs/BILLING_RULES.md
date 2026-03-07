<!-- SHARED: subradar-backend, subradar-web, subradar-mobile -->
<!-- Canonical: subradar-backend/docs/BILLING_RULES.md -->
<!-- Synced: 2026-03-07 -->

# SubRadar AI — Billing Rules

## Plans

### Free
- Up to 5 subscriptions
- Manual add only
- Basic reminders (1 day before billing)
- Basic analytics (monthly total, category breakdown)
- 1 PDF summary per month
- No AI audit
- No OCR/photo AI
- No advanced insights

### Pro ($2.99/mo)
- Unlimited subscriptions
- AI add by text
- AI photo/screenshot parsing
- AI duplicate detection
- Advanced analytics + forecast (6mo, 12mo)
- Monthly AI audit
- Unlimited PDF reports
- Trial killer (trial tracking with alerts)
- Custom categories/tags
- Export history

### Team ($9.99/mo)
- Everything in Pro
- Workspace with multiple members
- Dashboards per employee
- Shared reports
- Budgeting
- Team audit
- Owner analytics
- Member invite/management

## Trial Trigger Logic

Trial must NOT start on first app launch or on empty account.

Trial triggers after ONE of these events:
1. User added 2 subscriptions
2. User opened AI insight for the first time
3. User clicked "Get audit"

This ensures user sees value before trial starts, preventing wasted trial days.

## Trial Duration
- 7 days of Pro features
- After trial: downgrade to Free (keep data, lose Pro features)

## Feature Gating

| Feature | Free | Pro | Team |
|---------|------|-----|------|
| Max subscriptions | 5 | Unlimited | Unlimited |
| Manual add | Yes | Yes | Yes |
| AI text add | No | Yes | Yes |
| AI photo add | No | Yes | Yes |
| AI duplicate detection | No | Yes | Yes |
| Basic analytics | Yes | Yes | Yes |
| Advanced analytics | No | Yes | Yes |
| Forecast (6mo, 12mo) | No | Yes | Yes |
| Monthly AI audit | No | Yes | Yes |
| PDF summary | 1/month | Unlimited | Unlimited |
| Trial killer | No | Yes | Yes |
| Custom tags | No | Yes | Yes |
| Export | No | Yes | Yes |
| Workspace | No | No | Yes |
| Team reports | No | No | Yes |
| Budgeting | No | No | Yes |

## Paywall Display

Paywall screen must clearly show:
- What's included in Free
- What's included in Pro
- What's included in Team
- Why to upgrade
- What result user gets

## Billing Provider
- Lemon Squeezy (Merchant of Record)
- Webhook: `POST /billing/webhook` (verified by signature)
- Checkout: redirect to Lemon Squeezy hosted page
- Status sync via webhook events: `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_payment_success`, `subscription_payment_failed`
