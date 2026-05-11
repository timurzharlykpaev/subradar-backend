#!/bin/bash
# SubRadar API deploy — zero-downtime via nginx upstream port swap.
#
# Strategy (blue-green on a single host):
#   1. Discover the port the live container currently binds. Pick the OTHER
#      port from the configured pair as the staging port.
#   2. Start `${CONTAINER}-new` on the staging port. The old container keeps
#      serving traffic — no downtime so far.
#   3. Wait until the new container's `/health` returns 200.
#   4. Run pending TypeORM migrations inside the new container (idempotent;
#      no-ops if the migrations table is in sync).
#   5. Rewrite the nginx upstream block to point at the new port, then
#      `nginx -s reload` (atomic, drops zero connections).
#   6. Brief drain pause, then stop + remove the old container and rename
#      the new one to the canonical name.
#
# Usage:
#   ./deploy.sh                       # default = subradar-api-prod
#   ./deploy.sh subradar-api-prod
#   ./deploy.sh subradar-api-dev
set -e

CONTAINER=${1:-subradar-api-prod}
case "$CONTAINER" in
  *dev*)
    TAG=dev
    NODE_ENV=development
    NGINX_CONF=/etc/nginx/sites-enabled/api-dev.subradar.ai
    PORT_A=8083
    PORT_B=8087
    ENV_FILE=/opt/subradar/.env.dev
    APP_PORT=8080
    ;;
  *)
    TAG=latest
    NODE_ENV=production
    NGINX_CONF=/etc/nginx/sites-enabled/api.subradar.ai
    PORT_A=8082
    PORT_B=8086
    ENV_FILE=/opt/subradar/.env.prod
    APP_PORT=8080
    ;;
esac
IMAGE="ghcr.io/timurzharlykpaev/subradar-backend:$TAG"

echo "[deploy] target=$CONTAINER image=$IMAGE env=$NODE_ENV"

echo "[deploy] Pulling image..."
docker pull "$IMAGE" || { echo "[deploy] pull failed"; exit 1; }

# Discover live port by reading nginx upstream config.
if grep -qE "127\.0\.0\.1:$PORT_A\b" "$NGINX_CONF"; then
  OLD_PORT=$PORT_A
  NEW_PORT=$PORT_B
elif grep -qE "127\.0\.0\.1:$PORT_B\b" "$NGINX_CONF"; then
  OLD_PORT=$PORT_B
  NEW_PORT=$PORT_A
else
  # First-time deploy after migration to blue-green: assume PORT_A is current
  # if the canonical container is listening there, else PORT_B.
  CURRENT=$(docker port "$CONTAINER" "$APP_PORT" 2>/dev/null | awk -F: '{print $2}' | head -1)
  if [ "$CURRENT" = "$PORT_A" ]; then OLD_PORT=$PORT_A; NEW_PORT=$PORT_B
  else OLD_PORT=$PORT_B; NEW_PORT=$PORT_A; fi
  echo "[deploy] nginx upstream not yet pinned — inferred OLD=$OLD_PORT NEW=$NEW_PORT from container"
fi
echo "[deploy] OLD_PORT=$OLD_PORT NEW_PORT=$NEW_PORT"

NEW_NAME="${CONTAINER}-new"

# Clean up any stale staging container from a previous failed deploy.
docker rm -f "$NEW_NAME" 2>/dev/null || true

echo "[deploy] Starting $NEW_NAME on port $NEW_PORT..."
docker run -d \
  --name "$NEW_NAME" \
  --restart unless-stopped \
  --network subradar_subradar \
  --env-file "$ENV_FILE" \
  -e PORT=$APP_PORT \
  -p "$NEW_PORT:$APP_PORT" \
  "$IMAGE" >/dev/null

echo "[deploy] Waiting for /health on port $NEW_PORT..."
for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:$NEW_PORT/api/v1/health" >/dev/null 2>&1; then
    echo "[deploy] healthy after $((i*2))s"
    break
  fi
  if [ "$i" = "40" ]; then
    echo "[deploy] FAIL — new container never reported healthy on $NEW_PORT"
    docker logs --tail 50 "$NEW_NAME"
    docker rm -f "$NEW_NAME"
    exit 1
  fi
  sleep 2
done

echo "[deploy] Running migrations on $NEW_NAME..."
docker exec -e NODE_ENV="$NODE_ENV" "$NEW_NAME" node -e '
require("dotenv/config");
const path = require("path");
const fs = require("fs");
const { DataSource } = require("typeorm");
const migDir = "/app/dist/migrations";
const migs = fs.readdirSync(migDir)
  .filter(f => f.endsWith(".js"))
  .flatMap(f => Object.values(require(path.join(migDir, f))));
const ds = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  entities: [],
  migrations: migs,
  migrationsTableName: "migrations",
});
(async () => {
  await ds.initialize();
  const ran = await ds.runMigrations({ transaction: "each" });
  console.log("[migrations] applied " + ran.length + " new");
  for (const m of ran) console.log("  - " + m.name);
  await ds.destroy();
})().catch(e => { console.error("[migrations] FAILED:", e.message); process.exit(1); });
' || { echo "[deploy] migrations failed — aborting"; docker rm -f "$NEW_NAME"; exit 1; }

echo "[deploy] Swapping nginx upstream: $OLD_PORT -> $NEW_PORT..."
# Store the backup OUTSIDE sites-enabled — nginx loads everything in that dir
# as a live server block, so a stray `.bak` would re-bind ports and break the
# `nginx -t` test below.
BACKUP_DIR=/opt/subradar/nginx-backups
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/$(basename "$NGINX_CONF").bak.$(date +%s)"
cp "$NGINX_CONF" "$BACKUP_FILE"

# Rewrite every "127.0.0.1:OLD_PORT" to the new port. The word-boundary stops
# 8082 from also matching e.g. 80820 in another block.
sed -i -E "s/127\.0\.0\.1:${OLD_PORT}\b/127.0.0.1:${NEW_PORT}/g" "$NGINX_CONF"

if ! nginx -t >/tmp/nginx-test.log 2>&1; then
  echo "[deploy] nginx config test failed:"
  cat /tmp/nginx-test.log
  # Rollback the active config; old container is still serving traffic so we
  # never went off-line.
  cp "$BACKUP_FILE" "$NGINX_CONF"
  docker rm -f "$NEW_NAME"
  exit 1
fi
nginx -s reload

echo "[deploy] Draining old container for 5s (let nginx finish in-flight)..."
sleep 5

echo "[deploy] Stopping + removing old $CONTAINER..."
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true

echo "[deploy] Renaming $NEW_NAME -> $CONTAINER..."
docker rename "$NEW_NAME" "$CONTAINER"

docker ps --filter "name=$CONTAINER" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo "[deploy] Done — no downtime."
