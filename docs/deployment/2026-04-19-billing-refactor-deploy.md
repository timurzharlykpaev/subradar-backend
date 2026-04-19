# Billing Refactor Deploy Checklist — 2026-04-19

## Pre-deploy
- [ ] Run migrations locally + verify revert works (one last time)
- [ ] Confirm env vars are set in prod:
  - REVENUECAT_API_KEY
  - REVENUECAT_WEBHOOK_SECRET
  - BILLING_HEALTH_TOKEN
  - BILLING_RECONCILIATION_ENABLED=false (initial)
  - BILLING_RECONCILIATION_DRY_RUN=true (initial)
- [ ] Back up prod DB
- [ ] Alert team in #engineering

## Deploy
- [ ] Merge PR to main
- [ ] Watch CI pass
- [ ] Migrations run automatically
- [ ] Tail logs for webhook errors for 10 min

## Post-deploy (first hour)
- [ ] GET /api/v1/health/billing returns stats
- [ ] Trigger test RC sandbox purchase → webhook received → user plan updated
- [ ] Check Grafana /api/v1/health/billing dashboard: webhookFailureRate == 0
- [ ] Verify outbox empty or draining (outboxPending < 50)

## 24 hours after deploy
- [ ] Review reconciliation dry-run logs
- [ ] Set BILLING_RECONCILIATION_DRY_RUN=false
- [ ] Set BILLING_RECONCILIATION_ENABLED=true
- [ ] Restart service

## First week monitoring
- [ ] Daily webhook failure rate check
- [ ] Daily outbox failed count
- [ ] Reconciliation mismatch audit

## Rollback
- npm run migration:revert (six times) — reverts all new migrations in order
- Redeploy prev tag via CI
