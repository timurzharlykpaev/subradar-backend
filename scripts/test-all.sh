#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo ""
echo "╔══════════════════════════════════╗"
echo "║  SubRadar Backend Test Suite     ║"
echo "╚══════════════════════════════════╝"
echo ""

# Unit tests
echo "━━━ Unit Tests ━━━"
npm test -- --passWithNoTests 2>&1 | tail -5
echo ""

# E2E tests (if DB available)
echo "━━━ E2E Tests ━━━"
if pg_isready -h localhost -p 5432 -U test 2>/dev/null; then
  npm run test:e2e -- --forceExit 2>&1 | tail -10
else
  echo "⚠️  PostgreSQL not running — skipping E2E"
  echo "   Run: docker-compose up -d postgres redis"
fi
echo ""
echo "✅ Done"
