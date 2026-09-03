# Black Ops CRM — Project Handoff

A self-contained brief for a developer or AI assistant picking this up. Drop this
file into your AI coding tool, then read the repo. **Read `CLAUDE.md` next — it
holds the load-bearing schema decisions and must be followed exactly.**

---

## 1. What this is

A CRM replacing the Gravity Forms setup that ran across ten `*.blkops.com`
WordPress installs for **Freedom Behavioral Health** (behavioral-health sales/
referral tracking across multiple Louisiana campuses).

- **Stack:** Vite + React (JavaScript, no TypeScript) · React Router · Supabase
  (Postgres + Auth + RLS + Edge Functions) · deployed on Vercel.
- **Repo:** `github.com/brenlamar88/blkops-test`, working branch
  `claude/healthcare-recovery` (check `git branch` for the exact name).
- **Supabase project ref:** `hhycqqtwhdofwbxmnbsr`.
- **No component library** — hand-rolled components in `src/components/`, one
  stylesheet `src/styles.css`. Dense "instrument-panel" UI, mobile-friendly.

Getting-started docs already in the repo: `QUICKSTART.md` (run it), `DEPLOY.md`
(ship schema + functions), `IMPORT.md` (load WordPress data), `CLAUDE.md`
(architecture — **authoritative**).

---

## 2. Architecture you must not break

These are the decisions that cost real rework. Full detail in `CLAUDE.md`.

- **Migrations are append-only.** `supabase/migrations/` is a baseline already
  applied to production. **Never edit an existing migration** — add a new
  timestamped one, and append its idempotent form to `scripts/catch-up.sql`.
- **Companies + contacts are a shared registry** (one row per real account for
  the whole org). Which campus works an account, and under which territory, is on
  the **`facility_companies`** junction — **not** on `companies`. Companies/
  contacts queries must NOT filter by facility; transactional queries MUST.
- **Territories are per-facility.** Monroe's "Red" ≠ Lake Charles's "Red";
  composite FKs `(territory_id, facility_id)` enforce it. A city or company can
  map to different territories at different campuses. There is **no universal
  city/territory list** — everything is per-campus.
- **Territory auto-fill** on activities/referrals comes from a per-facility
  city→territory map (`territory_cities`) via a `before insert/update` trigger
  (`fill_territory_from_city`), only when territory is left blank.
  *(In-flight: moving this to prefer the company's per-campus assignment on
  `facility_companies.territory_id` — see Roadmap.)*
- **Roles live on `facility_members`**, per campus — a rep at one campus can be a
  manager at another. RLS everywhere calls `my_facilities()` / `is_admin_at()`.
- **Needs-analysis revision triggers are `DEFERRABLE INITIALLY DEFERRED`
  constraint triggers.** Do not convert to ordinary triggers. `submitted_at` uses
  `clock_timestamp()`. Every revision has a `source` (user/import/system).
- **The anon key in `src/lib/supabase.js` is public by design** (RLS protects
  everything). The `service_role` key must never be in the app or the repo.

---

## 3. What's built (pages & routes)

App shell: `src/App.jsx`. Nav defined once in `src/lib/menu.js`
(shared by the sidebar and the per-user menu toggles). Mobile: sidebar becomes a
drawer; data tables collapse to cards below 680px.

| Route | Page | Notes |
|---|---|---|
| `/` | Dashboard | KPI tiles (exact counts), recent activity/referrals |
| `/companies`, `/companies/:id`, …/new, …/edit | Companies | shared registry; **duplicate detection** on create (soft warning); territory column |
| `/contacts`, …/new, …/edit | Contacts | belong to a company; territory derived |
| `/territories` | Territories | **campus-scoped** companies grouped by territory (reads `facility_companies.territory_id`) |
| `/prospectus` | Prospectus | **placeholder — coming soon**, awaiting parameters |
| `/needs-analysis`, …/company/:id, …/:id/history | Needs analysis | one per company, full revision ledger; search-to-start |
| `/activities`, …/new, …/edit | Activities | form 113 model; inline "add contact"; company **search** picker; territory auto-fill |
| `/referrals`, …/new, …/edit | Referrals | form 135 model; same picker/add-contact; territory column |
| `/activity-dashboard` | Activity dashboard | rebuild of the Gravity Forms analytics screen (donuts, KPIs) |
| `/touch-analysis` | Touch analysis | pivot of touches by activity type × company category, week/month, graded vs a weekly goal (rebuilt from the CEO workbook) |
| `/reports` | Reports | needs-analysis-by-rep, activity log, referral log; CSV export; territory columns |
| `/territory-map` | Admin → Territory map | edit the per-campus **city → territory** map |
| `/users` | Admin → Users | assign campuses + role per user; per-user menu visibility; create logins (via Edge Function) |
| `/campuses` | Admin → Campuses | add a campus; a trigger seeds its 4 territories + makes creator admin |

Reusable components: `ui.jsx` (Field/Select/DataTable/Modal/Chip/TerritoryChip…),
`CompanyPicker.jsx` (debounced server search), `QuickAddContact.jsx`,
`charts.jsx` (dependency-free SVG donut). Data layer: `src/lib/data.jsx`
(`useApp`, `useQuery`, `fetchAll` paginator, `save`, `territoryForCity`).

---

## 4. Schema & data state

~30 tables. Key ones: `organizations` → `facilities` → `facility_members`;
`companies`/`contacts` (+ `facility_companies` junction); `daily_activities`,
`referrals`, `needs_analysis` (+ `_facility`/`_clinical`/`_revisions`);
lookups (`categories`, `subcategories`, `contact_roles`, `payer_sources`,
`territories`, `territory_cities`, `service_cycle_stages`, …); `user_menu_visibility`.
Enums mirrored in `src/lib/enums.js`. Read the migrations for the full shape;
`supabase/tests/*.sql` (49 plain-SQL assertions) document the invariants.

**Live data as of this handoff (verify with the Supabase connector — it changes):**
- Companies **~2,637**, Contacts **~2,164**, Activities **~9,253**, Referrals **~579**,
  Needs analyses **0**.
- **Lake Charles** is the loaded campus (2,633 companies). **Monroe** partially
  loaded (~80 of ~2,538). The other ~9 campuses are empty.
- **No company has a territory assigned** on `facility_companies` yet
  (all "Unassigned"). Territory data is coming from a spreadsheet (see Roadmap).

---

## 5. Run, build, test

```bash
npm install
npm run dev        # http://localhost:5173  (needs a login — see QUICKSTART.md)
npm run build
./scripts/verify.sh   # boots throwaway Postgres, applies all migrations, runs the 49 tests
```
`useApp()` provides session, campus membership, current `facilityId`, and lookups.
Sign in, pick a campus, work. RLS makes tables look empty until you're a member of
a campus (that's the security model, not a bug).

---

## 6. Deploying changes (important — three separate targets)

Full detail in `DEPLOY.md`.

1. **Frontend** (`src/`) → Vercel auto-deploys on push. Nothing to do.
2. **Database schema** → migration files don't touch the live DB. Run:
   ```bash
   export SUPABASE_DB_URL='postgresql://postgres:…@db.hhycqqtwhdofwbxmnbsr.supabase.co:5432/postgres'
   ./scripts/deploy-db.sh          # applies scripts/catch-up.sql (idempotent, safe to re-run)
   ```
   When you add a migration, **also append its idempotent form to
   `scripts/catch-up.sql`** so this stays complete.
3. **Edge Functions** (`supabase/functions/`) →
   `supabase functions deploy <name> --project-ref hhycqqtwhdofwbxmnbsr`.
   Currently one: `create-user` (mints logins server-side; already deployed).

**Gotcha:** the Supabase web SQL editor runs over a pooled connection where
session temp tables don't persist across statements. Scripts that use temp
tables (the data-import and contact-merge scripts) must be run with **`psql -f`**,
not pasted into the web editor. `catch-up.sql` is fine either way.

---

## 7. One-off scripts (`scripts/`)

- `import.mjs` — the original Node importer for Gravity Forms CSVs (needs the
  service key). See `IMPORT.md`.
- `merge-duplicate-contacts.sql` — merge same-company/same-name duplicate
  contacts (non-destructive; single-statement so it runs anywhere).
- `seed-lakecharles-territories.sql` — **deprecated approach** (universal city
  seed); superseded by per-campus territory data. Don't use.
- Data imports are generated per campus as tested `psql -f` files (the Monroe one
  was built from `companies.csv` + `contacts.csv`: dedup by name, map categories/
  states/roles, link to the campus with territory).

---

## 8. Roadmap / in-flight (what to pick up next)

1. **Territory assignment from spreadsheet.** The user has a companies↔territory
   spreadsheet, **per campus, with overlap** (a company can be in different
   territories at different campuses). Plan: load it into
   `facility_companies.territory_id` per campus (generated, tested `psql -f`
   file). Then the `/territories` page populates and auto-fill works per campus.
2. **Territory auto-fill precedence.** Change `fill_territory_from_city` to prefer
   the company's `facility_companies.territory_id` for the campus, falling back to
   the city map. More accurate than city-based guessing.
3. **Finish Monroe import** — the tested `import-monroe.sql` was generated but not
   yet run; then import the other ~9 campuses (same 2-form export → dry-run →
   `psql -f`). Expect heavy company overlap (shared registry dedups it).
4. **Needs-analysis form fidelity.** The form works but may not match the live
   Gravity Forms field-for-field (forms 55/72/114/152). Read fields from the live
   form, not a spec. Missing: payer-sources checklist, practitioners list.
5. **Prospectus page** — build once parameters are provided.
6. **Needs analyses not imported** anywhere yet (0 rows).

---

## 9. Rules for whoever builds next

- Follow `CLAUDE.md`. Run `./scripts/verify.sh` before any schema change; add
  assertions to `supabase/tests/`.
- New migration ⇒ also update `scripts/catch-up.sql`.
- Keep companies/contacts org-wide; keep territory per-facility. Don't put
  territory on `companies`.
- Don't hard-delete records that are referenced (use `merged_into_id` + `active`).
- Never commit or expose the `service_role` key.
