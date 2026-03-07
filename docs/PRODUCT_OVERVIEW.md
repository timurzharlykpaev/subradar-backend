<!-- SHARED: subradar-backend, subradar-web, subradar-mobile -->
<!-- Canonical: subradar-backend/docs/PRODUCT_OVERVIEW.md -->
<!-- Synced: 2026-03-07 -->

# SubRadar AI — Product Overview

## 1. What is SubRadar AI

SubRadar AI is a mobile-first subscription tracking app for iOS and Android that helps individuals and teams:

- Store all subscriptions in one place
- See future expenses for 1, 6, and 12 months ahead
- Get reminders before billing and before trial expiration
- Detect duplicates, unnecessary services, and potential savings
- Generate AI-powered reports and PDF summaries
- Manage family or team subscription spending

**Primary scenario:** User adds subscriptions manually, via text, or via photo/screenshot -> AI recognizes the subscription -> User confirms data -> System calculates expenses, sends reminders, builds analytics, and shows savings opportunities.

## 2. Product Goal

> "I finally understand how much I pay for subscriptions and I can control it."

Not just a subscription list, but:
- Financial transparency
- Spending forecast
- AI insights
- Trial period control
- Easy decision-making

## 3. Core Principles

### 3.1 Mobile-first
The main product is a React Native mobile app. Mobile is the primary usage path.

### 3.2 AI assists, does not decide
AI can suggest services, parse amounts, find duplicates, build forecasts, give recommendations. But AI must NOT automatically create a charge or subscription without user confirmation when confidence is low or data is ambiguous.

### 3.3 Every AI feature must have a fallback
If AI fails, the user must be able to: enter data manually, pick a service from a list, edit all fields, save without AI.

### 3.4 Value first, paywall later
Trial must NOT start on an empty screen. User should first:
- Add at least 1-2 subscriptions
- See first analytics
- Get first insight
- Only then trigger trial/Pro purchase

### 3.5 Team and family are separate scenarios
They should not be mixed into the basic personal scenario too early. Single-user UX must be perfected first.

## 4. Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile | React Native (Expo SDK 51) |
| Backend | NestJS + TypeScript |
| Database | PostgreSQL |
| Cache/Queue | Redis + BullMQ |
| Web | React 18 + Vite + TypeScript |
| Auth | Google OAuth (access_token flow), Apple Sign-In, Magic Link |
| AI | OpenAI GPT-4o |
| Storage | DigitalOcean Spaces |
| Billing | Lemon Squeezy (Merchant of Record) |
| Email | Resend |
| Push | Firebase Cloud Messaging |
| Landing | Static HTML (subradar.ai) |

**Infrastructure:**
- Server: DigitalOcean `46.101.197.19`
- Prod API: `https://api.subradar.ai/api/v1` (port 3100)
- Dev API: `https://api-dev.subradar.ai/api/v1` (port 3101)
- Prod Web: `https://app.subradar.ai`
- Dev Web: `https://app-dev.subradar.ai`
- Landing: `https://subradar.ai`

## 5. Target Audience

### Personal user (3-30 subscriptions)
Netflix, YouTube Premium, ChatGPT, Spotify, Apple/Google/cloud/VPN/SaaS, courses, AI tools.

### Power user / freelancer / developer
DigitalOcean, Vercel, OpenAI, GitHub, Figma, Notion, Cursor, Claude, domains, servers.

### Team owner
Pays for employee subscriptions, wants to see: who uses what, where are duplicates, how much is spent, what can be removed.

## 6. Competitive Advantages

| Feature | Rocket Money | Bobby | SubRadar AI |
|---------|-------------|-------|-------------|
| AI voice input | - | - | + |
| Screenshot recognition | - | - | + |
| AI regional plan search | - | - | + |
| Payment card mapping (last4) | - | - | + |
| Tax report PDF | - | - | + |
| Receipt uploads | - | - | + |
| Server/infra subscriptions | - | - | + |
| Team plan | - | - | + |
| Trial Killer (trial tracking) | - | - | + |
| AI expense analysis | - | - | + (Pro) |
| Monthly AI audit | - | - | + (Pro) |

## 7. Monetization

### Free
- Up to 5 subscriptions
- Manual add only
- Basic reminders
- Basic analytics
- 1 PDF summary per month
- No AI audit, no OCR/photo AI, no advanced insights

### Pro ($2.99/mo)
- Unlimited subscriptions
- AI add by text
- AI photo parsing
- AI duplicate detection
- Advanced analytics + forecast
- Monthly AI audit
- PDF reports
- Trial killer
- Custom categories/tags
- Export history

### Team ($9.99/mo)
- Workspace with multiple members
- Dashboards per employee
- Shared reports
- Budgeting
- Team audit
- Owner analytics

### Trial trigger logic
Trial should NOT start at first launch. It should trigger after one of:
- User added 2 subscriptions
- User opened AI insight for the first time
- User clicked "Get audit"

This is much better than "7 days from install" because otherwise trial burns without value.

## 8. MVP Acceptance Criteria

The MVP is considered ready when:

1. User can sign in via Google
2. User can complete onboarding
3. User can add subscription manually
4. User can add subscription via AI text
5. User can add subscription via photo/screenshot
6. User can confirm or correct AI result
7. User sees subscription list
8. User sees home dashboard
9. User sees upcoming charges
10. User sees trial countdown
11. User receives push notifications 7 days and 1 day before billing
12. User sees monthly and yearly forecast
13. User can save card nickname + last4
14. User can generate PDF summary
15. Free limits and Pro gating work correctly
16. Analytics update after adding/editing subscription
17. Duplicate warning works at basic level
18. No sensitive card data stored
19. Dates and notifications work with timezone
20. AI errors do not break the add subscription flow

## 9. What to Exclude from First Release

- Gmail auto-import
- Voice input (except basic text-to-subscription)
- Complex tax reports
- Auto-cancel subscriptions
- Full web dashboard
- Complex B2B admin
- Full receipt management
- Full OCR for all document types
- Too many categories and enterprise logic

## 10. Key Product Metrics

### Activation
- Registered
- Added first subscription
- Added second subscription
- Enabled notifications
- Opened analytics

### Retention
- Returned after 7 days
- Returned after 30 days
- Didn't delete all subscriptions
- Opened reminder / report / audit

### Revenue
- Conversion to trial
- Trial -> paid conversion
- Churn, ARPU, MRR
- Team conversion

### Product Quality
- % AI parses confirmed without edits
- % AI parses corrected by user
- Report generation success rate
- Notification delivery success rate
