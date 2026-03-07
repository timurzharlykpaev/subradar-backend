# SubRadar AI — Jobs and Cron Tasks

## Overview

Heavy operations run asynchronously via BullMQ jobs and scheduled cron tasks. PDF generation, AI audits, and batch notifications must NOT be synchronous request-response.

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
