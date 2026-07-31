# Migrations

These three files are the **baseline**. They were rewritten in place during
design, which was safe only because nothing had been deployed.

That stops here. Once the baseline is applied to any real database:

- Never edit a file in this directory again.
- Every change is a new timestamped migration (`supabase migration new <name>`).
- Run `./scripts/verify.sh` before pushing — it rebuilds from scratch and runs
  the suite in `supabase/tests/`.

Applied in filename order:

| File | Contents |
|---|---|
| `…0001_baseline_schema.sql` | tenancy, registry, activity, referrals, needs analysis, revision ledger |
| `…0002_baseline_rls.sql` | row level security, facility-scoped |
| `…0003_baseline_reference_data.sql` | organization, ten facilities, lookup values |

Reference data lives in a migration rather than `seed.sql` because production
depends on it — a payer source or denial reason is not test data.
