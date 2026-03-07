# SubRadar AI — Backend Module Boundaries

## Module Map (NestJS)

### 1. Auth Module
Responsibilities:
- Google OAuth (web: access_token, mobile: server auth code)
- Apple Sign-In (mobile only)
- Magic Link (email via Resend)
- Access/refresh token management (JWT)
- User session lifecycle
- Token refresh endpoint

Endpoints: `/auth/*`

### 2. Users Module
Responsibilities:
- User profile CRUD
- Preferences (locale, timezone, currency, country)
- Onboarding flags
- Date format settings

Endpoints: `/users/*`

### 3. Subscriptions Module
Responsibilities:
- Subscription CRUD
- Status management (TRIAL, ACTIVE, PAUSED, CANCELLED, ARCHIVED)
- Billing date calculations
- Trial logic (trialEndDate tracking)
- Duplicate detection trigger (calls AI module)
- Archive/pause/restore actions

Endpoints: `/subscriptions/*`

### 4. Cards Module
Responsibilities:
- Payment card CRUD (safe metadata only: nickname, last4, brand, color)
- Default card management
- Card-subscription association

Endpoints: `/cards/*`

### 5. Analytics Module
Responsibilities:
- Home dashboard aggregation (total spend, delta, summary)
- Monthly trends calculation
- Category distribution
- Card-based breakdown
- Upcoming charges (next 30 days)
- Trial countdown
- Forecast (30d, 6mo, 12mo)
- Potential savings calculation

Endpoints: `/analytics/*`

### 6. AI Module
Responsibilities:
- Text input parsing (GPT-4o structured output)
- Image/screenshot parsing (GPT-4o vision)
- Service matching against known services DB
- Icon suggestion
- Duplicate detection logic
- Savings insights generation
- Monthly audit generation

Endpoints: `/ai/*`

### 7. Notifications Module
Responsibilities:
- FCM push token registration
- Reminder preference management
- Scheduled notification dispatch
- Trial expiry reminders
- Billing reminders (7 days, 1 day before)

Endpoints: `/notifications/*`

### 8. Reports Module
Responsibilities:
- Async PDF report generation (via BullMQ job)
- Report storage (DO Spaces)
- Report download
- Report types: SUMMARY, DETAILED, AUDIT, TAX
- Report status tracking (PENDING -> GENERATING -> READY | FAILED)

Endpoints: `/reports/*`

### 9. Billing Module
Responsibilities:
- Plan management (Free, Pro, Team)
- Lemon Squeezy checkout session creation
- Webhook processing (subscription lifecycle events)
- Feature gating (check user plan before allowing Pro features)
- Current plan status

Endpoints: `/billing/*`

### 10. Workspace Module
Responsibilities:
- Workspace CRUD
- Member management (invite, remove, role change)
- Team analytics aggregation
- Team report generation
- Role-based access (OWNER, ADMIN, MEMBER)

Endpoints: `/workspace/*`

### 11. Files / Attachments Module
Responsibilities:
- File uploads to DO Spaces
- Screenshot temporary storage for AI parsing
- Receipt uploads and storage
- Generated report PDF storage
- Cleanup of temporary files

No direct endpoints — used by other modules (AI, Reports, Receipts).

### 12. Audit / Logs Module
Responsibilities:
- Event history logging
- AI decision logging (what AI parsed, what user confirmed)
- User confirmation tracking
- Report generation logs
- Subscription change history

No direct endpoints — internal logging consumed by analytics and debugging.

## Module Dependencies

```
Auth ──> Users
Subscriptions ──> AI (duplicate detection), Cards, Notifications
Analytics ──> Subscriptions, Cards
AI ──> Files (image upload), external OpenAI API
Reports ──> Analytics, Files (PDF storage), BullMQ (async jobs)
Notifications ──> Subscriptions (billing dates), FCM
Billing ──> Users (plan status), Lemon Squeezy webhook
Workspace ──> Users, Subscriptions, Analytics
Audit ──> All modules (event logging)
```
