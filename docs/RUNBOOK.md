# Runbook — Incident Response

Quick-reference for common production incidents. Every scenario lists: **detect → diagnose → mitigate → verify → post-incident**.

On-call escalation: Telegram `@StepToGoalAlertbot` → direct message to founder. No formal rotation yet.

---

## 1. Database connection exhausted

### Detect
- Error rate spike in Sentry / logs: `TypeORMError: Connection terminated unexpectedly` or `remaining connection slots are reserved`.
- `/api/v1/health` returns 503 with `db: "error"`.
- Telegram alert from error-monitor.

### Diagnose
```bash
ssh -i ~/.ssh/id_steptogoal root@46.101.197.19
docker exec subradar-api-prod node -e \
  "require('pg').Client && console.log('ok')"

# Check active connections on managed DB
# Go to DigitalOcean console → Databases → subradar-prod-db → Metrics → Connections
# Or from within the app container:
docker exec subradar-api-prod psql "$DATABASE_URL" -c \
  "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"
```

Common causes:
- Long-running `idle in transaction` sessions (leak).
- Pool size misconfigured (see `DB_POOL_SIZE` env).
- Spike in traffic (e.g. AI endpoint bombardment).

### Mitigate
1. **Quick:** kill idle-in-transaction sessions:
   ```sql
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE state = 'idle in transaction'
     AND state_change < now() - interval '5 minutes';
   ```
2. **Scale pool:** set `DB_POOL_SIZE=40` in `.env.prod`, restart container.
3. **Scale DB:** on DO, resize the managed cluster (zero-downtime on standby tier).
4. **Rate-limit offender:** if single user is bombing, ban via `users.isBanned=true`.

### Verify
- `/health` returns 200 with `db: "ok"` for 10 min straight.
- `pg_stat_activity` count back to baseline (~20).

### Post-incident
- Write a short note in `#incidents` Telegram.
- If root cause was a leak — open issue, schedule fix within a week.

---

## 2. Redis down

### Detect
- `/health` → `redis: "error"`.
- BullMQ jobs not processing (`reminders`, `weekly-digest` backlog grows).
- Login / magic-link flaky (rate limiter depends on Redis).

### Diagnose
```bash
ssh -i ~/.ssh/id_steptogoal root@46.101.197.19
docker ps | grep redis
docker logs --tail 200 redis
docker exec redis redis-cli ping  # expect PONG
```

### Impact
- **Soft degrades:** cache misses → slower lookups. FX rates fall back to hard-coded table (fine). Magic-link tokens stored in Redis — new logins fail. Rate-limiting disabled.
- **Hard degrades:** BullMQ cannot enqueue or process → reminders stop going out.

### Mitigate
1. Restart container:
   ```bash
   docker restart redis
   ```
2. If Redis is out of memory (most common cause of crash):
   ```bash
   docker exec redis redis-cli INFO memory
   docker exec redis redis-cli CONFIG SET maxmemory-policy allkeys-lru
   ```
3. If container won't start, recreate (data is ephemeral):
   ```bash
   cd /opt/subradar
   docker compose up -d redis
   ```

### Verify
- `docker exec redis redis-cli ping` → `PONG`.
- BullMQ UI (if running) shows jobs processing.
- New magic-link login works end-to-end.

### Post-incident
- Check if a particular queue ballooned (indicates a stuck consumer).
- Consider adding `maxmemory` limit to docker-compose if not already.

---

## 3. OpenAI rate limit / quota

### Detect
- Sentry: `RateLimitError` or `InsufficientQuotaError` from the `ai` module.
- User reports "AI is not working" via support email.
- Spike in 429 responses on `/ai/*` endpoints.

### Diagnose
```bash
docker logs --tail 500 subradar-api-prod | grep -i "openai\|429\|quota"
# Check billing dashboard: https://platform.openai.com/usage
```

Typical triggers:
- Organic usage hit tier limit (3 k RPM on Tier 2).
- Runaway script / bug calling AI in a loop.
- Card expired / billing suspended.

### Mitigate
1. **Card / billing:** check OpenAI dashboard. If billing suspended, update card, limit will lift within minutes.
2. **Tier limit:** request tier increase in OpenAI dashboard (usually auto-granted after spend threshold).
3. **Loop / abuse:** inspect recent `/ai/*` requests in logs for a single user repeating — temp-ban via `users.isBanned`.
4. **Graceful degrade:** set `ENABLE_VOICE_AI=false` and/or `ENABLE_SCREENSHOT_AI=false` to shed load. Users can still add subscriptions manually.
5. **Scale up secondary key:** we keep a fallback key `OPENAI_API_KEY_BACKUP`. If set, client auto-retries on 429.

### Verify
- New AI requests succeed (`curl` a test call or trigger from staging).
- Error rate on `/ai/*` back below 1 %.

### Post-incident
- If a loop caused it — patch and deploy. Add a per-user quota in `AIService` if not present.

---

## 4. Webhook replay flood

### Detect
- Sentry: repeated HMAC failures on `/api/v1/billing/webhook`.
- Spike in 401/400 responses on that endpoint.
- Abnormal traffic from one IP in nginx access log.

### Diagnose
```bash
# Nginx access log on the proxy
ssh -i ~/.ssh/id_steptogoal root@46.101.197.19
docker exec nginx-proxy tail -500 /var/log/nginx/access.log \
  | grep '/billing/webhook' | awk '{print $1}' | sort | uniq -c | sort -rn
```

### Mitigate
1. **Block source IP** at nginx:
   ```bash
   # edit /opt/nginx/custom.conf
   deny 1.2.3.4;
   docker exec nginx-proxy nginx -s reload
   ```
2. **Block at droplet firewall (ufw):**
   ```bash
   ufw deny from 1.2.3.4
   ```
3. **Block at DO firewall** (UI) for a persistent attacker — survives droplet rebuild.
4. Ensure webhook endpoint short-circuits on invalid HMAC **before** any DB work (already the case, but verify).

### Verify
- Access log shows 403s from the blocked IP.
- Backend error rate drops.

### Post-incident
- If attack persists from a botnet, add Cloudflare in front of `api.subradar.ai`.

---

## 5. Mobile crash spike

### Detect
- Sentry Mobile project — crash-free-sessions < 99 %.
- App Store Connect → Crashes tab shows red spike.
- User complaints in support email.

### Diagnose
1. Open Sentry, group by `release` + `os.name`. Identify the offending version.
2. Check if the spike aligns with a recent release:
   ```bash
   eas build:list --platform ios --limit 5
   eas update:list --branch production --limit 5
   ```
3. Copy the top stack trace; check git blame on the offending file.

### Mitigate

**If it's a JS-only bug (most common):**
```bash
# Publish a reverted OTA update
eas update --branch production --republish --group <last-good-group-id>
```
Clients pick it up next foreground, usually within an hour.

**If it's a native bug:**
1. Revert the problematic commit → create a new build:
   ```bash
   git revert <bad-sha>
   git push origin main
   eas build --platform ios --profile production --auto-submit
   ```
2. Expedited review request in App Store Connect if severity is high.
3. Meanwhile, post a notice on `status.subradar.ai`.

**If auth-gated (new users cannot sign up):**
- Roll out a backend-side workaround (e.g., relax validation) to buy time while mobile fix ships.

### Verify
- Crash-free-sessions > 99 % for a rolling 1-hour window.
- Sentry issue resolved or muted with reason.

### Post-incident
- Add a regression test (unit or Maestro flow) that would have caught it.
- If it was a reanimated/Expo SDK issue, pin the version.

---

## 6. FX provider down

### Detect
- Sentry: repeated failures in `FxService.refreshRates()`.
- Cron `fx-refresh` alerts on backoff exhaustion.
- Users complaining that converted prices look stale or wrong.

### Diagnose
```bash
curl -v https://open.er-api.com/v6/latest/USD
# check response status + body
```

### Impact
- **Minimal.** The service already has a baked-in fallback rate table (see `src/fx/fallback-rates.ts`). Users see slightly stale rates but no errors.

### Mitigate
- **Built-in:** fallback rates kick in automatically on outage (tested).
- **Manual refresh** once upstream is back:
  ```bash
  docker exec subradar-api-prod node -e "require('./dist/fx/fx.service').refresh()"
  ```
- **Switch provider** (only if outage > 24 h): swap URL in `FxService` to `exchangerate.host` or similar free API.

### Verify
- `GET /api/v1/fx/rates` returns fresh `updatedAt` timestamp.
- Sentry errors cleared.

### Post-incident
- Consider a paid FX API (e.g., currencylayer) if free tier reliability becomes a recurring issue.

---

## General

### Useful commands

```bash
# SSH to droplet
ssh -i ~/.ssh/id_steptogoal root@46.101.197.19

# Tail prod API
docker logs --tail 200 -f subradar-api-prod

# Restart prod API
docker restart subradar-api-prod

# Exec into container
docker exec -it subradar-api-prod sh

# Show top CPU/mem consumers
docker stats --no-stream
```

### When in doubt
1. Don't panic — the built-in error-monitor auto-restarts on 5xx bursts.
2. Capture: log lines, timestamps, Sentry event id, affected user count (if known).
3. Mitigate first, root-cause after.
4. Post a short note in `#incidents` after resolution.
