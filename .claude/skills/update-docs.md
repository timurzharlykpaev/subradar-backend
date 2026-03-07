# Skill: Update Documentation

When making changes to backend code, update the relevant documentation:

1. **New/changed API endpoint** -> Update `docs/API_CONTRACTS.md`
2. **New/changed entity or field** -> Update `docs/DOMAIN_MODEL.md`
3. **New/changed module** -> Update `docs/MODULE_BOUNDARIES.md`
4. **New/changed cron job** -> Update `docs/JOBS_AND_CRONS.md`
5. **New/changed AI pipeline** -> Update `docs/AI_PIPELINES.md`
6. **Changed billing logic** -> Update `docs/BILLING_RULES.md`
7. **Changed subscription status rules** -> Update `docs/STATE_RULES.md`
8. **Completed MVP item** -> Check off in `PROGRESS.md`

Shared docs (PRODUCT_OVERVIEW, DOMAIN_MODEL, API_CONTRACTS, BILLING_RULES, AI_BEHAVIOR, STATE_RULES) also exist in subradar-web and subradar-mobile repos. After updating the canonical version here, note the sync header date needs updating in other repos.
