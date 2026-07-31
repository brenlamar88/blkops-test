# Black Ops CRM

Replacing the Gravity Forms CRM that runs across ten `*.blkops.com` WordPress
installs for Freedom Behavioral Health. Vite + React + Supabase, deployed to
Vercel.

## Read this before changing the schema

**Liveness was determined by newest entry date, never by entry count.** That
distinction cost this project three rounds of rework and is the single most
important thing to carry forward.

| Form | ID | Entries | Newest | Status |
|---|---|---|---|---|
| New CRM Contact | 113 | 7,523 | 2026-07-30 | **live** — activity capture |
| SDR Daily Referral Reporting Log (1) | 135 | — | 2026-07-30 | **live** — referrals |
| ElderCare Needs Analysis | 55 | 360 | 2026-07-15 | live |
| Clinic/Practitioner Needs Analysis | 114 | 58 | 2026-07-16 | live |
| Hospital Needs Analysis | 72 | 35 | — | live |
| Mental Health Needs Analysis | 152 | — | — | live |
| SDR Daily Activity Reporting (Nested) | 19 | 5,322 | **2020-02-20** | dead |
| SDR Daily Referral Reporting Log | 77 | 168 | **2020-05-15** | dead |

Forms 19 and 77 carry byte-identical entry counts on every install — a frozen
2020 dataset duplicated when the sites were cloned. Enum values were taken
from 19 and 77 at one point and were wrong; they now come from 113 and 135.

**If you need a form's field definitions**, read them from the live Gravity
Forms editor rather than from any spec. The original spec was accurate about
form 113 and wrong about form 152, and there was no way to tell without
looking.

## Schema shape

- `organizations` → `facilities` (10 campuses) → `facility_members`. Role lives
  on the membership, so a rep at one campus can be a manager at another. A user
  is assigned to many campuses by having many `facility_members` rows; the
  **Admin → Users** screen manages those (add/remove campus, set role), gated by
  RLS `is_admin_at(facility_id)` — a facility admin only touches their own
  campuses. Creating a brand-new login needs the service key, so it goes through
  the `create-user` Edge Function (`supabase/functions/`), which verifies the
  caller is an admin at the target campus before minting the account. New
  campuses are added under **Admin → Campuses** (org-admin only); the
  `SECURITY DEFINER` trigger `seed_new_facility` gives each new facility its
  four territories and makes the creator an admin of it — both otherwise
  blocked by RLS, since nobody is an admin at a facility that does not yet exist.
- **Menus are per-user.** `user_menu_visibility` holds one row per hidden menu
  item per user (menu_key = route path; Dashboard `/` is never hideable). The
  nav filters against the current user's rows, edited under Admin → Users. The
  menu list lives once in `src/lib/menu.js`, shared by the nav and the toggles.
- **Territories belong to a facility.** Monroe's "Red" is not Lake Charles's
  "Red". Composite FKs on `(territory_id, facility_id)` make the database
  reject cross-facility references.
- **Territory is assigned by city, per facility.** `territory_cities` maps each
  city a campus works to one of its own territories (unique per facility, matched
  case/whitespace-insensitively). `territory_for_city()` resolves it, and a
  `before insert/update` trigger (`fill_territory_from_city`) stamps `territory_id`
  on `daily_activities`, `referrals` and `facility_companies` **only when it is
  left blank** — a rep's explicit choice always wins. Re-mapping a city changes
  future auto-fills only; already-logged rows keep their stamped territory. This
  is *why* territory still isn't a column on the shared `companies` row. Edit the
  map in-app under **Admin → Territory map** (admin-only, RLS `tc_write`); the
  forms prefill from it client-side via `territoryForCity` in `data.jsx`.
- **`companies` and `contacts` are a shared registry** — one row per real
  account per organization. `facility_companies` records which campus works
  which account and under which of its own territories. Territory is
  deliberately *not* on `companies`; that was a bug. Adding a company runs
  `find_company_duplicates` (pg_trgm name similarity + same address & city) as a
  **soft** warning the rep can override — many providers legitimately share one
  hospital address; `companies.merged_into_id` collapses any that slip through.
- **Company-derived fields are never copied** onto transactional rows. Read
  city, address and phone through `needs_analysis_full` and `referrals_full`.
- **`needs_analysis` is one row per company**, enforced by a unique constraint.
  Every save appends to `needs_analysis_revisions`. That ledger *is* the rep
  productivity count.

### The revision triggers are load-bearing

`DEFERRABLE INITIALLY DEFERRED` constraint triggers, not ordinary ones. A save
updates the base row and then writes a detail row; an ordinary trigger fires
after the first write and snapshots a state that never existed. Deferring to
commit fixes that, and a transaction-local guard collapses the save into one
revision. Both behaviours are covered in `supabase/tests/001_schema.sql`. Do
not convert these to regular triggers.

`submitted_at` uses `clock_timestamp()`, not `now()` — `now()` is the
transaction timestamp and would stamp every row of an import identically.

Every revision carries a `source` of `user`, `import`, or `system`. Imports
have no `auth.uid()`, so without this they would count toward nobody.
`needs_analysis_productivity` counts `source = 'user'` only.

## Migrations

`supabase/migrations/` is a **baseline that has been applied to production**.
Never edit those files again. Every change is a new timestamped migration.

```bash
./scripts/verify.sh          # rebuild throwaway Postgres, apply all, run tests
./scripts/verify.sh --schema # migrations only
```

Applying to the **live** database is separate from writing a migration — see
`DEPLOY.md`. `./scripts/deploy-db.sh` applies `scripts/catch-up.sql`, an
idempotent bundle of every post-baseline migration. **When you add a migration,
append its idempotent form to `scripts/catch-up.sql`** (use `create ... if not
exists`, `create or replace`, `drop ... if exists` then create, or guarded `do`
blocks) so the deploy script stays complete.

25 assertions in `supabase/tests/`. Plain SQL, no pgTAP dependency. Run before
any schema change — writing these found four real bugs, including two that
would never have surfaced through the UI.

## Import

`scripts/import.mjs` reads Gravity Forms CSV exports. See `IMPORT.md`.

Hard-won lessons, all of which cost a failed run:

- **Dropdown exports contain placeholders** — `Select One`, `OTHER`,
  `-- Fill Out Other Fields --`. Enum columns reject them. The importer
  whitelists against real values rather than blacklisting placeholders.
- **Historical reps have no login.** `user_id` and `submitted_by` are nullable
  with a `source_rep_name` fallback; use `actor_label()` for reporting. The
  first version dropped every row whose rep did not match.
- **Real data violates check constraints.** Reps tick "next visit scheduled"
  and leave the date blank. There is a pre-flight pass that enforces every
  constraint before writing, and failed batches retry row by row.

### Current state

Lake Charles only: 2,633 companies, 2,217 contacts imported. Activities and
referrals not yet loaded. Needs analyses not loaded — the `needs-*.csv` exports
were missing or misnamed. Nine other campuses untouched.

**Before importing the other campuses**: the sites were cloned, so a large share
of those ~2,700 companies each are probably the same accounts repeated.
`companies.merged_into_id` exists for collapsing duplicates without breaking
the activities that reference them. Judge the overlap with one campus loaded.

## Known gaps

- Forms 151 (Community) and 153 (Home Based Care) have no entries, so their
  field lists could not be read. Both are modelled on the clinical shape by
  inference — if real entries appear and the fields diverge, that is a third
  detail table.
- `contact_roles` is inferred. No live form exposes a role list.
- Two `service_cycle_stages` are near-duplicates (ranks 1 and 2) — the live
  form has both; one should be retired.
- Form 135's `REFERRAL UNIT TYPE` (field 95) is unconfigured, still showing
  Gravity Forms placeholders "Unit A"/"Unit B". Not modelled.
- No admin UI for editing lookup values; use the Supabase table editor.
- RLS policy cost is unverified. Every policy calls `my_facilities()`. Fine at
  current volume; profile before this is a multi-customer product.

## Conventions

- `useQuery` in `src/lib/data.jsx` owns the load/error/empty lifecycle. Use it
  rather than hand-rolling `useEffect` fetches.
- `useApp()` provides session, campus membership, current `facilityId`, and
  lookups. Transactional queries must filter by `facilityId`; companies and
  contacts must not.
- Enum constants in `src/lib/enums.js` mirror the Postgres enums. Changing one
  means changing both plus a migration.
