# Infra upgrade — pgBouncer + nginx HTTP/2 + cache headers

Two changes ship together because they touch different layers and don't
interact: the nginx work changes the public edge for clients, the
pgBouncer work changes the data path between API and managed Postgres.
Roll out in the order below — each step is reversible on its own.

**Scope of impact on shipped App Store users:** none if executed
correctly. nginx changes are protocol-level (HTTP/1.1 → HTTP/2 is
transparent to old clients; they just stay on /1.1). pgBouncer changes
are inside the docker network — clients see the same host, same
endpoints, same response shape.

---

## Pre-flight (~5 minutes)

1. Server reachable over SSH (waiting on DigitalOcean billing unfreeze
   if you're reading this right after the suspension).
2. Snapshot the droplet from the DO panel — gives a one-click rollback
   for anything that goes sideways.
3. Confirm current state:
   ```bash
   ssh root@46.101.197.19 'cd /opt/subradar && docker ps && nginx -t'
   ```
4. Note the IPs and ports the API containers currently expose:
   ```bash
   docker inspect subradar-api-prod -f '{{.HostConfig.PortBindings}}'
   docker inspect subradar-api-dev  -f '{{.HostConfig.PortBindings}}'
   ```
   Expected: prod `8082:3000`, dev `8083:3000`. If different, adjust the
   `upstream` blocks in the nginx configs before applying.

---

## Phase 1 — nginx HTTP/2 + caching (15 min, zero downtime)

### 1.1 Copy configs to the server

From your laptop in `subradar-backend/`:

```bash
scp -i ~/.ssh/id_steptogoal \
  infra/nginx/api.subradar.ai.conf \
  infra/nginx/api-dev.subradar.ai.conf \
  root@46.101.197.19:/etc/nginx/sites-available/

scp -i ~/.ssh/id_steptogoal \
  infra/nginx/snippets/security-headers.conf \
  root@46.101.197.19:/etc/nginx/snippets/subradar-security-headers.conf
```

### 1.2 Validate, then reload

```bash
ssh root@46.101.197.19 '
  ln -sf /etc/nginx/sites-available/api.subradar.ai      /etc/nginx/sites-enabled/api.subradar.ai
  ln -sf /etc/nginx/sites-available/api-dev.subradar.ai  /etc/nginx/sites-enabled/api-dev.subradar.ai
  nginx -t
'
```

If `nginx -t` reports OK:

```bash
ssh root@46.101.197.19 'systemctl reload nginx'
```

`reload` is graceful — existing connections finish on the old config,
new ones hit the new one. No 502s.

### 1.3 Verify

From your laptop:

```bash
curl -sI -m 5 https://api.subradar.ai/api/v1/health -o /dev/null \
  -w 'HTTP: %{http_version}\nTLS: %{ssl_verify_result}\nTTFB: %{time_starttransfer}s\n'
```

Expected:
- `HTTP: 2` (was `1.1`)
- `Strict-Transport-Security` header present (`curl -sI ... | grep -i hsts`)
- `Cache-Control` is `no-store` on `/health`, `public, max-age=…` on
  `/api/v1/catalog/popular?…` and `/api/v1/fx/rates`

### 1.4 Rollback

If anything misbehaves:

```bash
ssh root@46.101.197.19 '
  rm /etc/nginx/sites-enabled/api.subradar.ai
  rm /etc/nginx/sites-enabled/api-dev.subradar.ai
  # restore original symlinks (whatever they pointed at before)
  systemctl reload nginx
'
```

---

## Phase 2 — pgBouncer in front of managed PG (~30 min, brief downtime)

This phase has a 10-30s connection blip per service when API switches
its DATABASE_URL from managed-PG-direct to pgbouncer. Schedule it for
a low-traffic window if possible.

### 2.1 Copy compose overlay

```bash
scp -i ~/.ssh/id_steptogoal \
  infra/docker-compose.pgbouncer.yml \
  root@46.101.197.19:/opt/subradar/
```

### 2.2 Verify which compose network the API uses

```bash
ssh root@46.101.197.19 'docker network ls | grep subradar'
```

Expected: `subradar_default` (default name when compose creates it from
`/opt/subradar/docker-compose.yml`). If yours has a different name,
edit `networks.default.name` in `docker-compose.pgbouncer.yml`
accordingly before pushing.

### 2.3 Start pgbouncer (BEFORE swapping API config)

```bash
ssh root@46.101.197.19 '
  cd /opt/subradar
  docker compose \
    -f docker-compose.yml \
    -f docker-compose.pgbouncer.yml \
    up -d pgbouncer-prod pgbouncer-dev

  # Wait for healthcheck to settle
  sleep 15
  docker ps --filter name=pgbouncer
'
```

### 2.4 Smoke-test pgbouncer can talk to managed PG

```bash
ssh root@46.101.197.19 '
  docker exec subradar-api-prod sh -c "
    apk add --no-cache postgresql-client 2>/dev/null || true
    PGPASSWORD=\$DB_PASSWORD psql \\
      -h subradar-pgbouncer-prod -p 6432 \\
      -U doadmin -d subradar \\
      -c \"SELECT 1 AS pgbouncer_ok\"
  "
'
```

If that returns `1 row`, pgbouncer is wired correctly and you can flip
the API over.

### 2.5 Update API env to use pgbouncer

Edit `/opt/subradar/.env.prod` on the server — change two lines:

```diff
- DATABASE_URL=postgresql://doadmin:...@dbaas-db-4327922-do-user-30639355-0.f.db.ondigitalocean.com:25060/subradar?sslmode=require
+ DATABASE_URL=postgresql://doadmin:${DB_PASSWORD}@subradar-pgbouncer-prod:6432/subradar?sslmode=disable

- DB_HOST=dbaas-db-4327922-do-user-30639355-0.f.db.ondigitalocean.com
+ DB_HOST=subradar-pgbouncer-prod

- DB_PORT=25060
+ DB_PORT=6432

- DB_SSL=true
+ DB_SSL=false
```

`sslmode=disable` is correct here: pgbouncer ↔ managed-PG is encrypted
upstream, but API ↔ pgbouncer stays inside the docker network.

Same for `.env.dev` (substitute `subradar-pgbouncer-dev` and database
name `subradar_dev`).

### 2.6 Restart API to pick up new env

```bash
ssh root@46.101.197.19 '
  cd /opt/subradar
  docker compose up -d --force-recreate subradar-api-prod
  # Wait & verify
  sleep 20
  docker inspect subradar-api-prod --format "{{.State.Health.Status}}"
  curl -sf -m 5 https://api.subradar.ai/api/v1/health | jq
'
```

If `health: ok` and DB shows up — done. Same for dev.

### 2.7 Rollback pgBouncer

If anything breaks:

```bash
ssh root@46.101.197.19 '
  # 1) Revert env back to managed PG direct
  cd /opt/subradar
  $EDITOR .env.prod  # change DB_HOST, DB_PORT, DB_SSL back

  # 2) Recreate API
  docker compose up -d --force-recreate subradar-api-prod

  # 3) Stop pgbouncer (keeps the image around for next try)
  docker compose -f docker-compose.yml -f docker-compose.pgbouncer.yml \
    stop pgbouncer-prod pgbouncer-dev
'
```

---

## Verification checklist (post-deploy)

| What | How | Expected |
|---|---|---|
| HTTP/2 in effect | `curl -sI ... -w "%{http_version}"` | `2` |
| HSTS header | `curl -sI ... \| grep -i strict` | `max-age=31536000` |
| Catalog cached on edge | `curl -sI .../catalog/popular?... \| grep -i cache` | `public, max-age=300, …` |
| pgbouncer reachable | `docker exec api psql -h pgbouncer-prod -p 6432 -c '\dt'` | tables list |
| API healthy | `curl ... /health` | `{status: ok, db: up, redis: up}` |
| Cron not erroring | `docker logs subradar-api-prod \| grep -i error \| tail -20` | empty |
| Real PG conn count | DO Database panel "Active connections" | drops vs baseline |

---

## What this gives you

Cumulative effect (rough numbers from the analysis):
- TTFB on multi-request screens: **−20 to −30%** (HTTP/2 + keepalive)
- Repeat-visit latency for far regions: **−40 to −60%** once Cloudflare
  is in front honouring `Cache-Control` on `/catalog/popular`, `/fx/rates`
- Effective DB connection capacity: **~25 → ~150** concurrent
  short-tx clients
- One-time cron storms no longer trip `connection_limit_exceeded`

After this lands, the next infra upgrade is **Cloudflare in front of
api.subradar.ai** — almost free, gives you global edge cache + DDoS +
WAF. See the analysis doc for the full Stage-1 plan.
