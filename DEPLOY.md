# Deploying changes

Two things live outside the frontend and have to be pushed to Supabase
separately: **database schema** and the **Edge Functions**. Vercel handles the
app itself on every push; this file covers the other two.

---

## 1. Database schema — the automated way

Every schema change is a timestamped file in `supabase/migrations/`, which is
the source of truth. Those files are proven locally with `./scripts/verify.sh`
(rebuilds a throwaway Postgres, applies everything, runs the test suite) — but
that does **not** touch your live database. To catch the live database up, run
one script.

### One-time setup
1. Get your connection string: Supabase → **Project Settings → Database →
   Connection string → URI**. Use the **Session** (or Direct) string — not the
   transaction pooler. It looks like:
   ```
   postgresql://postgres:YOUR-PASSWORD@db.hhycqqtwhdofwbxmnbsr.supabase.co:5432/postgres
   ```
2. Put it in your shell (or a local, gitignored `.env`):
   ```bash
   export SUPABASE_DB_URL='postgresql://postgres:YOUR-PASSWORD@db.hhycqqtwhdofwbxmnbsr.supabase.co:5432/postgres'
   ```
3. Make sure `psql` is installed (macOS: `brew install libpq && brew link --force libpq`).

### Every time you want the DB current
```bash
./scripts/deploy-db.sh
```
That applies `scripts/catch-up.sql` — **every post-baseline change, made
idempotent** (it only creates what's missing, and it's safe to run twice). No
Docker, no login, no migration history to manage. Run it after pulling new
migrations; if nothing changed, it's a no-op.

> `scripts/catch-up.sql` is regenerated whenever a new migration is added, so it
> always represents "everything after the production baseline." The baseline
> itself (`20260730*`) is already on the live database and is never re-run.

### No `psql`? Paste instead.
Open `scripts/catch-up.sql`, copy the whole file, and run it in the Supabase
**SQL Editor**. Same result.

### Prefer the official CLI? (optional)
The Supabase CLI's `db push` is the standard once its migration history is
adopted. One-time reconciliation is needed because the baseline was applied
before the CLI tracked it:
```bash
supabase init                       # creates supabase/config.toml (keep functions)
supabase link --project-ref hhycqqtwhdofwbxmnbsr
./scripts/deploy-db.sh              # make the DB current first
# tell the CLI these are already applied so push won't re-run them:
supabase migration repair --status applied 20260730000001 20260730000002 \
  20260730000003 20260731000004 20260731000005 20260731000006 20260731000007
```
After that, future changes are just: add a migration file → `supabase db push`.

---

## 2. Edge Functions

Currently one function: `create-user` (mints new logins for **Admin → Users**;
the rest of user management works without it).

```bash
supabase functions deploy create-user --project-ref hhycqqtwhdofwbxmnbsr
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — no
secrets to set. Deploy once; redeploy only if the function code changes. Run it
from the repo root so `supabase/functions/create-user/index.ts` is found (a
stale local clone won't have it — `git pull` first).

If deploy complains about Docker, either start Docker Desktop or update the CLI
(`brew upgrade supabase`), which deploys without it.

**Don't need it?** Create users the manual way: Supabase → Authentication →
Add user (Auto Confirm), then assign campuses/roles under Admin → Users.

---

## Quick reference

| I changed… | Do this |
|---|---|
| Frontend (`src/`) | nothing — Vercel deploys on push |
| Schema (`supabase/migrations/`) | `./scripts/deploy-db.sh` |
| An Edge Function (`supabase/functions/`) | `supabase functions deploy <name> --project-ref hhycqqtwhdofwbxmnbsr` |

Before any schema change, run `./scripts/verify.sh` to prove it locally.
