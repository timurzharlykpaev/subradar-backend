#!/usr/bin/env bash
# Помечает InitialSchema как уже выполненную на существующей БД.
# Запускать ОДИН РАЗ на проде если таблицы уже созданы через synchronize.
#
# Usage: bash scripts/mark-baseline.sh

set -e

MIGRATION_NAME="InitialSchema1740873600000"
TIMESTAMP=1740873600000

echo "Marking migration '${MIGRATION_NAME}' as executed..."

psql "$DATABASE_URL" <<SQL
CREATE TABLE IF NOT EXISTS "migrations" (
  "id"        serial PRIMARY KEY,
  "timestamp" bigint NOT NULL,
  "name"      character varying NOT NULL
);

INSERT INTO "migrations" ("timestamp", "name")
SELECT ${TIMESTAMP}, '${MIGRATION_NAME}'
WHERE NOT EXISTS (
  SELECT 1 FROM "migrations" WHERE "name" = '${MIGRATION_NAME}'
);
SQL

echo "Done. Migration marked as baseline."
