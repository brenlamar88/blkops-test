#!/usr/bin/env bash
# Boot a throwaway PostgreSQL, apply every migration, and run the test suite.
# Mirrors what Supabase does, minus the hosted auth schema (stubbed below).
#
#   ./scripts/verify.sh            apply migrations and run tests
#   ./scripts/verify.sh --schema   apply migrations only
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/tmp/pgdata}
PGSOCK=${PGSOCK:-/tmp/pgrun}
PGPORT=${PGPORT:-5433}
DB=${DB:-blkops}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

psql_() { su postgres -c "$PGBIN/psql -h $PGSOCK -p $PGPORT $*"; }

boot() {
  if ! su postgres -c "$PGBIN/pg_isready -h $PGSOCK -p $PGPORT" >/dev/null 2>&1; then
    rm -rf "$PGDATA" "$PGSOCK" /tmp/pglog
    mkdir -p "$PGDATA" "$PGSOCK" /tmp/pglog
    chown -R postgres "$PGDATA" "$PGSOCK" /tmp/pglog
    su postgres -c "$PGBIN/initdb -D $PGDATA -A trust" >/dev/null 2>&1
    su postgres -c "$PGBIN/pg_ctl -D $PGDATA \
      -o '-k $PGSOCK -p $PGPORT -c listen_addresses=' \
      -l /tmp/pglog/pg.log -w start" >/dev/null 2>&1
  fi
}

# Supabase provides auth.users and auth.uid(). Stub them so migrations that
# reference them apply identically here.
stub() {
  cat >/tmp/_stub.sql <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
SQL
  psql_ "-d $DB -v ON_ERROR_STOP=1 -q -f /tmp/_stub.sql"
}

boot
psql_ "-q -c 'drop database if exists $DB;' -c 'create database $DB;'" >/dev/null
psql_ "-d $DB -q -c 'create extension if not exists pgcrypto;'" >/dev/null
stub

for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '  applying %-28s' "$(basename "$f")"
  if psql_ "-d $DB -v ON_ERROR_STOP=1 -q -f $f" 2>/tmp/_err; then
    echo "ok"
  else
    echo "FAILED"; cat /tmp/_err; exit 1
  fi
done

[ "${1:-}" = "--schema" ] && { echo "schema applied"; exit 0; }

echo
for f in "$ROOT"/supabase/tests/*.sql; do
  echo "  running $(basename "$f")"
  psql_ "-d $DB -v ON_ERROR_STOP=1 -q -f $f" || exit 1
done
echo
echo "all tests passed"
