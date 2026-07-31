# Black Ops CRM — quickstart

Your database is already live at `hhycqqtwhdofwbxmnbsr.supabase.co` with all
26 tables, the ten campuses, and every dropdown value pulled from your live
forms. This gets the website in front of you.

## 1. Make yourself a login (once)

Supabase → **Authentication → Users → Add user**. Use your email, set a
password, tick **Auto Confirm User**.

Then Supabase → **SQL Editor** and run this, with your email:

```sql
insert into facility_members (facility_id, user_id, role)
select f.id, p.id, 'admin' from facilities f, profiles p
where p.email = 'YOU@EMAIL.COM'
on conflict (facility_id, user_id) do update set role = 'admin';
```

Access is granted per campus. Without that row you can sign in but see nothing —
the app tells you so rather than showing empty tables.

## 2. Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173 and sign in.

## 3. Put it online

```bash
npx vercel
```

Accept the defaults. It prints a URL you can open anywhere, including your
phone. Run `npx vercel --prod` when you want the permanent address.

The Supabase URL and public key are baked into `src/lib/supabase.js` as
fallbacks, so the deploy works without configuring anything. Both are public by
design — they ship in the browser bundle regardless, and grant nothing on their
own because every table sits behind row level security.

## What's in it

| Screen | What it does |
|---|---|
| Dashboard | counts, last 7 days of activity, referrals awaiting an outcome |
| Companies | shared across campuses; add one and it appears on every form |
| Contacts | linked to a company, with character traits |
| Activities | modelled on form 113, including stage of service cycle |
| Referrals | modelled on form 135, with denial reasons and admit rate |
| Needs analysis | one per company, every edit kept with who and when |
| Reports | needs analysis per rep, activity log, referral log; CSV export |

The campus switcher is at the top of the sidebar. Everything transactional is
scoped to the campus you have selected; companies and contacts are shared.

## Verifying the database

```bash
./scripts/verify.sh
```

Rebuilds a throwaway Postgres from the migrations and runs 25 assertions. Run
it before any schema change.

## Not done yet

- **No data import.** ~2,700 companies and ~2,800 contacts per site, across ten
  sites. Almost certainly heavily duplicated, since the sites were cloned. Needs
  a matching pass before anything is loaded; `companies.merged_into_id` exists
  for collapsing duplicates without breaking references.
- **Forms 151 and 153** (Community, Home Based Care) had no entries to read, so
  both are modelled on the clinical shape by inference.
- **No admin screens** for editing dropdown values — do it in Supabase's table
  editor for now.
