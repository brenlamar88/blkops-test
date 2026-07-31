# Importing a campus from WordPress

Repeat per campus. Nothing is written until you pass `--commit`.

## 1. Export the CSVs from Gravity Forms

On the campus site, go to **Forms → Import/Export → Export Entries**. For each
form below: pick the form, click **Select All** fields, set a date range of
everything, and download.

| Form | Save the file as |
|---|---|
| 124 CRM Company | `companies.csv` |
| 123 CRM Contact | `contacts.csv` |
| 113 New CRM Contact | `activities.csv` |
| 135 SDR Daily Referral Reporting Log (1) | `referrals.csv` |
| 55 ElderCare Needs Analysis | `needs-eldercare.csv` |
| 72 Hospital Needs Analysis | `needs-hospital.csv` |
| 114 Clinic/Practitioner Needs Analysis | `needs-clinic.csv` |
| 152 Mental Health Needs Analysis | `needs-mental.csv` |

Put them here:

```
import-data/lakecharles/companies.csv
import-data/lakecharles/contacts.csv
...
```

Every file is optional — it imports whatever is present. Start with just
`companies.csv` if you want to see it work before committing to the rest.

## 2. Get a service role key

Supabase → **Settings → API → service_role**. This key bypasses all security,
so it exists only in your terminal for this job. Never put it in the app, never
commit it.

```bash
export SUPABASE_URL=https://hhycqqtwhdofwbxmnbsr.supabase.co
export SUPABASE_SERVICE_KEY=eyJ...
```

The reason it's needed: row level security requires a signed-in user, and a
script has none. That's the same protection that made the tables look empty
before you logged in.

## 3. Dry run

```bash
node scripts/import.mjs --campus lakecharles
```

Prints what it *would* do and writes nothing:

```
Planned:
    2431  companies to insert
     262  companies already present
    2790  contacts to insert
    7488  activities to insert
      12  referrals downgraded to Pending (denial reason unmatched)
     418  needs analyses (unique companies)
     841  needs analysis revisions to replay
```

Read those numbers before going further. If companies is near zero, the column
headers in your export don't match what the script looks for — send me the
first line of the CSV and I'll adjust it.

## 4. Commit

```bash
node scripts/import.mjs --campus lakecharles --commit
```

## What it does with the messy parts

**Companies** are deduplicated by name, ignoring case and punctuation, both
within the file and against what's already in the database. Re-running is safe;
it skips what exists.

**Needs analyses** collapse to one per company. Where a company has several
historical entries, the oldest becomes the record and each later one is
replayed as an update — so the History screen shows the account's real
progression instead of duplicate rows. Each replay writes a ledger entry.

**Denials with an unrecognised reason** are imported as Pending rather than
dropped, and counted in the summary. Losing a referral is worse than losing one
field, and Pending is visible and fixable.

**Rows whose rep can't be matched** to a user account are skipped and counted,
not silently reassigned. Create the missing users first and re-run if the count
is high.

## Do Lake Charles first, then check

Before importing the other nine, look at what landed. The sites were cloned
from a common source, so a large share of these records may be the same
accounts repeated. `companies.merged_into_id` exists for collapsing duplicates
without breaking the activities that point at them — but it's much easier to
judge the overlap with one campus loaded than with ten.
