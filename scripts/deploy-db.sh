#!/usr/bin/env bash
# Apply every post-baseline schema change to the live Supabase database in one
# idempotent shot. No Docker, no CLI login, no migration-history bookkeeping.
# Safe to run repeatedly — it only creates what's missing.
#
#   export SUPABASE_DB_URL='postgresql://postgres:[PASSWORD]@db.hhycqqtwhdofwbxmnbsr.supabase.co:5432/postgres'
#   ./scripts/deploy-db.sh
#
# Get the URL from Supabase → Project Settings → Database → "Connection string"
# (URI). Use the Session/Direct string, not the transaction pooler. See DEPLOY.md.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="${SUPABASE_DB_URL:-${DATABASE_URL:-}}"

if [ -z "$URL" ]; then
  echo "error: set SUPABASE_DB_URL to your Supabase connection string first." >&2
  echo "       see DEPLOY.md for where to find it." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql is not installed." >&2
  echo "       macOS: brew install libpq && brew link --force libpq" >&2
  echo "       or paste scripts/catch-up.sql into the Supabase SQL editor instead." >&2
  exit 1
fi

echo "Applying scripts/catch-up.sql to the database…"
psql "$URL" -v ON_ERROR_STOP=1 -f "$DIR/catch-up.sql"
echo "✓ Database is up to date."
