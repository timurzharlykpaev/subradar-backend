# Status Page & Uptime Monitoring

**Status:** planned — not yet set up. Tracking here so it isn't lost.

## Goal

Public status page at `status.subradar.ai` plus internal alerting for availability of the production API and critical integrations.

## Provider: Better Uptime

[Better Uptime](https://betteruptime.com) — free tier covers our current needs (10 monitors, 3-min interval, 1 status page).

## Setup checklist

- [ ] Create account at [betteruptime.com](https://betteruptime.com) under `ops@subradar.ai`
- [ ] Enable 2FA, store recovery codes in 1Password (ops vault)
- [ ] Create team `SubRadar`, invite founders as admins
- [ ] **Monitor 1 — API health**
  - URL: `https://api.subradar.ai/api/v1/health`
  - Method: GET
  - Expected response: HTTP 200, body contains `"ok":true`
  - Interval: 3 min
  - Regions: EU (Frankfurt), US (New York)
  - Timeout: 10 s
  - Retries: 2 before alert
- [ ] **Monitor 2 — Dev API health** (lower priority)
  - URL: `https://api-dev.subradar.ai/api/v1/health`
  - Interval: 5 min
- [ ] **Monitor 3 — Web app**
  - URL: `https://app.subradar.ai`
  - Expected: HTTP 200, keyword `SubRadar`
- [ ] **Monitor 4 — Landing**
  - URL: `https://subradar.ai`
- [ ] **Status page**
  - Subdomain: `status.subradar.ai` (CNAME to Better Uptime)
  - Components: `API`, `Web app`, `Mobile API`, `Landing`
  - Public, no password
  - Branding: SubRadar logo, primary color `#8B5CF6`
- [ ] **Alert channels**
  - Primary: Telegram — existing bot `@StepToGoalAlertbot`, chat id in 1Password
  - Secondary: Email to `ops@subradar.ai`
  - Escalation: PagerDuty / phone — **not configured** until first incident proves need
- [ ] **Alert policy**
  - Critical (API down ≥ 1 retry): immediate Telegram + email
  - Warning (slow response > 3 s): email only
  - Auto-resolve when checks recover
- [ ] Test the alerting chain: manually stop `subradar-api-prod` on staging hours, confirm Telegram message within 5 min, restart
- [ ] Document the on-call rotation in `docs/RUNBOOK.md` once status page is live

## Health endpoint spec

The `/api/v1/health` endpoint should return:

```json
{
  "ok": true,
  "version": "1.2.3",
  "uptime": 12345,
  "checks": {
    "db": "ok",
    "redis": "ok"
  }
}
```

Return 503 if any check fails so the monitor flags the outage.

## SLO targets (aspirational)

| Service | Target uptime | Measurement window |
|---------|--------------|-------------------|
| API | 99.5 % | rolling 30 days |
| Web app | 99.5 % | rolling 30 days |
| AI endpoints | 99.0 % | rolling 30 days (depends on OpenAI) |

Missing the target two months in a row → incident review + infra changes.

## External dependency monitoring

Not directly monitored via status page yet (backend logs cover these):
- OpenAI — tracked internally via error rate on `/ai/*`
- RevenueCat — tracked via webhook delivery rate
- Lemon Squeezy — tracked via webhook delivery rate
- Firebase FCM — tracked via job failure rate in BullMQ

Consider adding these as `status.subradar.ai` subcomponents once Better Uptime is wired up.
