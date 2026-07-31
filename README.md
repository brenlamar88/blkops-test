# Black Ops CRM — schema

Multi-facility replacement for the Gravity Forms CRM running across the ten
`*.blkops.com` WordPress installs.

## Applying and verifying

```bash
./scripts/verify.sh          # rebuild from scratch, apply migrations, run tests
./scripts/verify.sh --schema # migrations only
```

Migrations are a **baseline** and must not be edited once applied anywhere real
— see `supabase/migrations/README.md`. 26 tables, RLS on all 26, 52 policies,
12 enums, 9 triggers, 25 passing assertions.

Tests live in `supabase/tests/` as plain SQL assertions — no extension needed,
so they run under `psql -f` on Supabase, in CI, or locally. They cover the
things that break silently: revision counting, snapshot fidelity, attribution,
tenant isolation, and every check constraint.

## How values were verified

Liveness was determined by **newest entry date**, not entry count:

| Form | Entries | Newest | Status |
|---|---|---|---|
| 113 New CRM Contact | 7,523 | 2026-07-30 | **live** — activity capture |
| 55 ElderCare NA | 360 | 2026-07-15 | live |
| 114 Clinic/Practitioner NA | 58 | 2026-07-16 | live |
| 72 Hospital NA | 35 | — | live |
| 19 SDR Daily Activity | 5,322 | 2020-02-20 | dead |
| 135 SDR Daily Referral Reporting Log (1) | — | 2026-07-30 | **live** — referral capture |
| 77 SDR Referral Log | 168 | 2020-05-15 | dead |

Forms 19 and 77 carry byte-identical entry counts on every install — a frozen
2020 dataset duplicated when the sites were cloned. Activity enums come from
form 113. The 89-company dropdown is also identical across installs, so it
reflects cloning, not shared account coverage.

## Structure

**Tenancy.** `organizations` → `facilities` → `facility_members`. Role lives on
the membership, so a rep at one facility can be a manager at another and a
corporate user is simply a member of many.

**Territories are per facility.** Monroe's "Red" is not Lake Charles's "Red".
Composite foreign keys on `(territory_id, facility_id)` mean the database
rejects one facility referencing another's territory rather than trusting the
application to remember.

**Referrals come from form 135**, a single shared form with a `Campus`
selector covering all ten sites — which is direct evidence for the
multi-facility model rather than ten isolated ones. Campus maps to
`facility_id`.

**Shared registry.** `companies` and `contacts` hold one row per real-world
account per organization. `facility_companies` records which facility works
which account and under which of its own territories. Territory is deliberately
*not* on `companies` — that was the bug this design fixes.

**Company-derived fields are not copied onto transactional rows.** City of
referral is the referring company's city; a needs analysis's address is the
company's address. Both are read through `referrals_full` and
`needs_analysis_full` rather than stored twice. This matters more than usual
here: with one analysis per company, a stored address would be frozen into
every revision snapshot and drift silently from the company record.

**Six intake forms, still two shapes.** Community and Home Based Care join
Practitioner and Mental Health on the clinical shape — they have no bed count
or facility type, but they do have a gatekeeper, an office manager and a
referral pathway. Forms 151 and 153 have no entries, so this is a modelling
judgement, not a transcription; moving either to the facility table later is a
detail-row migration, not a redesign.

**Needs analysis is one record per company**, enforced by a unique constraint,
with `needs_analysis_revisions` as an append-only ledger. Every save writes one
revision carrying the actor, the timestamp, and a full JSON snapshot.

The revision triggers are `deferrable initially deferred` constraint triggers.
This is load-bearing: a single save updates the base row and then writes a
detail row, and a normal trigger would snapshot after the first write and miss
the second. Deferring to commit means the snapshot is always the committed
state, while a transaction-local guard collapses the whole save into exactly
one revision. Both behaviours are covered by the tests below.

Rep productivity comes straight off the ledger — `needs_analysis_productivity`
splits new analyses from updates and counts both. The ledger has a SELECT
policy and nothing else, so the people being measured cannot edit their counts;
only the SECURITY DEFINER trigger appends.

## Attribution

Every revision carries a `source` of `user`, `import`, or `system`. A migration
script has no logged-in user, so `auth.uid()` is null; without the source
column those revisions would be attributed to nobody and silently counted as
zero work. An importer sets `blkops.revision_source = 'import'` and may also set
the JWT subject to the rep the historical entry belonged to, so old work is
attributed correctly while staying distinguishable from live entry.
`needs_analysis_productivity` counts `source = 'user'` only. A check constraint
makes "a user save must have a user" an invariant.

## Verified behaviour

- Three saves, one of which touched two tables, produce exactly three revisions
- A revision's payload reflects the full committed state of that save
- A second needs analysis for the same company is rejected
- A facility cannot reference another facility's territory
- Productivity view attributes each save to the rep who made it

## Known gaps

- **`REFERRAL UNIT TYPE` on form 135 (field 95) is unconfigured** — its options
  are still the Gravity Forms placeholders "Unit A" and "Unit B". The form also
  carries a working `Unit Type` (field 96) with the real values, so field 95
  looks like a duplicate that was never finished. Not modelled here.
- **Form 135's `Campus` list includes MANY and omits Bastrop**, which the
  site list does have. Ten campuses either way, but confirm which is right.
- **`contact_roles` is inferred.** No live form exposes a role list; the needs
  analysis forms use fixed labelled slots.
- **Two service cycle stages are near-duplicates** (ranks 1 and 2). Both are
  seeded so existing entries map cleanly; one should probably be retired.
- **Gold territory is seeded everywhere but form 77 offers only Red/White/Blue**,
  so the live referral form cannot currently record a Gold referral.
- **Forms 151 and 153 have no entries**, so their field lists could not be
  read. Both are modelled on the clinical shape by inference.
- No data migration. Collapsing the existing needs-analysis entries into
  one-per-company with a revision chain is reconstructable from entry
  timestamps, but it is a real import step.
- The React app in `src/` still targets the previous single-facility schema.
