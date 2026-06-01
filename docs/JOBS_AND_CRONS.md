# SubRadar AI — Jobs and Cron Tasks

## Overview

Heavy operations run asynchronously via BullMQ jobs and scheduled cron tasks. PDF generation, AI audits, and batch notifications must NOT be synchronous request-response.

## Actual `@Cron` schedule registry (source of truth)

The sections further below describe intended product behaviour; this table mirrors the **real** `@Cron(...)` decorators in code. Keep it in sync when changing any schedule, and mirror hourly/daily expectations in `CRON_EXPECTED_INTERVAL_MS` (`src/common/heartbeat.service.ts`).

> **Connection-budget rule:** prod and dev share ONE DigitalOcean managed-PG Basic cluster (`max_connections=25`, ~17 usable slots after DO internals/superuser). The always-on `outbox` tick (every 10s) and `health-watch` (every minute) both fire at `:00`. **No new cron may be scheduled at the top of the hour (`:00`)** — past `:00` pile-ups saturated the pool and produced `timeout of 2000ms exceeded` / `ECONNREFUSED …:25060` bursts at midnight. Stagger across the hour instead.

| Handler | Schedule | File |
|---|---|---|
| `outbox` tick | every 10s | `billing/outbox/outbox.worker.ts` |
| `health-watch` | every minute | `common/health-watch.cron.ts` |
| `sendDailyReminders` | `2 * * * *` | `reminders/reminders.service.ts` |
| `sendTrialExpiryReminders` | `7 * * * *` | `reminders/reminders.service.ts` |
| `sendProExpirationReminders` | `12 * * * *` | `reminders/reminders.service.ts` |
| `sendWeeklyPushDigest` | `17 * * * *` | `reminders/reminders.service.ts` |
| `sendWinBackPush` | `22 * * * *` | `reminders/reminders.service.ts` |
| `expireTrials` | `33 * * * *` | `reminders/reminders.service.ts` |
| `reconciliation` | `40 * * * *` | `billing/reconciliation/reconciliation.cron.ts` |
| `heartbeatMonitor` | `50 * * * *` | `common/heartbeat.cron.ts` |
| `resetExpiredGrace` | `5 0 * * *` | `billing/grace-period.cron.ts` |
| `downgradeExpiredTrials` | `30 0 * * *` | `subscriptions/trial-checker.cron.ts` |
| `subscriptions` daily date-advance | `0 1 * * *` | `subscriptions/subscriptions.service.ts` |
| `fxRefreshDaily` | `0 3 * * *` | `fx/fx.cron.ts` |
| `checkExpiringTrials` | `0 9 * * *` | `subscriptions/trial-checker.cron.ts` |
| `warnExpiringProTrials` | `15 9 * * *` | `subscriptions/trial-checker.cron.ts` |
| `cleanupAbandonedWorkspaces` | `45 9 * * *` | `billing/grace-period.cron.ts` |
| `sendMonthlyReports` | `0 10 1 * *` | `reminders/monthly-report.service.ts` |
| weekly analysis / catalog | `0 9/12 * * 1`, `0 3 * * 0`, `0 4 * * 1` | `analysis/`, `catalog/` |

**Diagnostics:** every PG connection is tagged `application_name = subradar-<NODE_ENV>` (see `app.module.ts`), so `SELECT application_name, count(*) FROM pg_stat_activity GROUP BY 1` in the DO console shows whether prod or dev is consuming slots.

**Scaling fix (recommended):** enable the DO **connection pool** (transaction mode, port `25061`) and point `DATABASE_URL` at it — this lifts the 25-slot ceiling. See the `extra` block / `.env.example` notes. Compatible with current TypeORM usage (unnamed prepared statements only).

## Daily Job (runs once per day)

### Triggers
- Cron schedule: `0 8 * * *` (8:00 AM UTC, adjusted per user timezone)

### Tasks
1. **Upcoming charges in 7 days** — Find subscriptions with nextBillingDate within 7 days, send push notification
2. **Upcoming charges in 1 day** — Find subscriptions with nextBillingDate tomorrow, send push notification
3. **Trials ending soon** — Find TRIAL subscriptions with trialEndDate within 3 days, send alert
4. **Overdue/invalid date check** — Find subscriptions with nextBillingDate in the past, flag for review or auto-advance date based on billingPeriod
5. **Trial auto-transition** — TRIAL subscriptions past trialEndDate: transition to ACTIVE (or CANCELLED if user set preference)

### Implementation Notes
- Process users in batches to avoid memory issues
- Respect user timezone for notification timing
- Log all notifications sent to audit module

## Weekly AI Job (optional, runs once per week)

### Triggers
- Cron schedule: `0 10 * * 1` (Monday 10:00 AM UTC)

### Tasks
1. **Gentle insights** — Summarize week's spending patterns
2. **Summary refresh** — Recalculate analytics cache
3. **Smart recommendations** — Detect new savings opportunities

### Notes
- Only for Pro users
- Should not be overwhelming — max 1 notification per week

## Monthly AI Audit Job (runs once per month)

### Triggers
- Cron schedule: `0 9 1 * *` (1st of month, 9:00 AM UTC)

### Tasks
1. **Calculate total changes** — Compare this month vs last month
2. **Detect new subscriptions** — List subscriptions added this month
3. **Detect duplicates** — Run AI duplicate detection across all active subscriptions
4. **Detect cost growth** — Flag subscriptions that increased in price
5. **Build audit report** — Compile findings into structured audit
6. **Generate PDF** — Create PDF audit report (async via BullMQ)
7. **Notify user** — Send push notification that audit is ready

### Notes
- Only for Pro users
- PDF generation must be async (BullMQ job)
- Store audit in Reports table with type = 'AUDIT'

## Report Generation Job (on-demand, async)

### Trigger
- User requests report via `POST /reports`

### Flow
1. Create Report record with status = PENDING
2. Queue BullMQ job for PDF generation
3. Job picks up: status -> GENERATING
4. Generate PDF using PDFKit
5. Upload to DO Spaces
6. Update Report: status -> READY, fileUrl -> spaces URL
7. Send push notification: "Your report is ready"

### Error handling
- If generation fails: status -> FAILED
- User can retry via `POST /reports` again
- Log error to audit module

## Analytics Cache Refresh

### Trigger
- After subscription create/update/delete
- After import

### Tasks
- Recalculate: monthly total, category breakdown, upcoming charges, forecast
- Store in Redis cache with 1-hour TTL
- Invalidate on subscription changes

## Job Queue Configuration (BullMQ)

```typescript
// Queue names
'report-generation'    // PDF reports
'ai-audit'            // Monthly AI audit
'notification-dispatch' // Batch notifications
'analytics-refresh'    // Cache invalidation
```

All jobs use Redis as the queue backend. Failed jobs retry 3 times with exponential backoff.
