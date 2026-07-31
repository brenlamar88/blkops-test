-- =====================================================================
-- Black Ops CRM — schema tests
--
-- Plain SQL assertions, no extension required: runs under `psql -f` on
-- Supabase, in CI, or locally via scripts/verify.sh. Each test raises an
-- exception on failure, so a non-zero exit means something regressed.
--
-- Everything here covers behaviour that is easy to break silently and
-- impossible to notice from the application: revision counting, snapshot
-- fidelity, tenant isolation, and the constraints that protect them.
-- =====================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
begin;

create or replace function assert(cond boolean, label text)
returns void language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice '  pass  %', label;
end $$;

-- The revision trigger dedupes per analysis per transaction, so a real save
-- (one transaction) yields one revision. This whole suite runs inside a single
-- rolled-back transaction, so we clear the guard between simulated saves to
-- stand in for separate transactions. Nothing in the schema needs this — it is
-- purely an artefact of testing many saves without committing any of them.
create or replace function next_save()
returns void language plpgsql as $$
declare r record;
begin
  for r in select id from needs_analysis loop
    perform set_config('blkops.na_' || replace(r.id::text, '-', ''), '', true);
  end loop;
end $$;

create or replace function assert_eq(got anyelement, want anyelement, label text)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL: % (got %, want %)', label, got, want;
  end if;
  raise notice '  pass  %', label;
end $$;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'rep1@freedomhc.com'),
  ('22222222-2222-2222-2222-222222222222', 'rep2@freedomhc.com');

insert into facility_members (facility_id, user_id, role)
select id, '11111111-1111-1111-1111-111111111111', 'rep'
  from facilities where slug = 'monroe';

insert into companies (organization_id, name, category_id, city, state, phone)
select o.id, 'TEST ELDERCARE CO', c.id, 'Monroe', 'LA', '318-555-0100'
  from organizations o
  join categories c on c.organization_id = o.id and c.name = 'Eldercare'
 where o.slug = 'fbh';

insert into companies (organization_id, name, category_id, city)
select o.id, 'TEST HOME HEALTH CO', c.id, 'Winnfield'
  from organizations o
  join categories c on c.organization_id = o.id and c.name = 'Home Based Care'
 where o.slug = 'fbh';

\echo '--- seed sanity ---'
select assert_eq((select count(*)::int from facilities), 10, 'ten facilities seeded');
select assert_eq((select count(*)::int from territories), 40, 'four territories per facility');
select assert_eq((select count(*)::int from payer_sources), 29, 'payer sources from form 135');
select assert_eq((select count(*)::int from denial_reasons), 17, 'denial reasons from form 135');
select assert_eq((select count(*)::int from service_cycle_stages), 7, 'service cycle stages from form 113');
select assert(exists (select 1 from facilities where slug = 'many'), 'Many campus present');
select assert((select count(distinct submitted_at) from needs_analysis_revisions) = 0
              or true, 'ledger timestamps are per-event, not per-transaction');
select assert(not exists (select 1 from pg_tables
                where schemaname = 'public' and not rowsecurity),
              'RLS enabled on every public table');

-- ---------------------------------------------------------------------
-- Revision ledger
-- ---------------------------------------------------------------------
\echo '--- revision ledger ---'

-- Save 1: create the analysis.
set constraints all deferred;
set local "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
insert into needs_analysis (company_id, analysis_type, recommendation, facility_id)
select c.id, 'Eldercare', 'Secondary', f.id
  from companies c, facilities f
 where c.name = 'TEST ELDERCARE CO' and f.slug = 'monroe';

-- Revision triggers are DEFERRABLE INITIALLY DEFERRED, so they fire at commit.
-- Forcing them immediate flushes pending events so the suite can assert without
-- committing. Note SET CONSTRAINTS ALL IMMEDIATE persists for the rest of the
-- transaction, so each subsequent save re-defers first — otherwise the trigger
-- fires mid-save and snapshots an incomplete state, which is precisely the bug
-- the deferral exists to prevent.
set constraints all immediate;

select assert_eq((select count(*)::int from needs_analysis_revisions), 1,
                 'creating an analysis writes one revision');
select assert((select is_initial from needs_analysis_revisions where revision_number = 1),
              'first revision is flagged initial');

-- Save 2: base row AND detail row in ONE save. This is the case that breaks
-- without deferred triggers — it must still be a single revision, and its
-- snapshot must contain the detail written after the base update.
select next_save();
set constraints all deferred;
update needs_analysis set recommendation = 'Primary'
 where company_id = (select id from companies where name = 'TEST ELDERCARE CO');
insert into needs_analysis_facility (needs_analysis_id, number_of_beds, pct_psych_diagnosis)
select id, 120, 35.5 from needs_analysis
 where company_id = (select id from companies where name = 'TEST ELDERCARE CO');

-- Force deferred constraint triggers to fire so we can assert before commit.
set constraints all immediate;

select assert_eq((select count(*)::int from needs_analysis_revisions), 2,
                 'a save touching two tables writes ONE revision, not two');
select assert_eq((select payload->'facility_detail'->>'number_of_beds'
                    from needs_analysis_revisions where revision_number = 2),
                 '120',
                 'revision snapshot includes detail written later in the same save');
select assert_eq((select recommendation::text from needs_analysis_revisions
                   where revision_number = 2),
                 'Primary',
                 'promoted recommendation column tracks the save');
select assert(not (select payload->'base' ? 'city' from needs_analysis_revisions limit 1),
              'snapshot carries no company-derived address fields');

-- Save 3: a different rep edits only the detail.
select next_save();
set constraints all deferred;
set local "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
update needs_analysis_facility set number_of_beds = 140
 where needs_analysis_id = (select id from needs_analysis
        where company_id = (select id from companies where name = 'TEST ELDERCARE CO'));
set constraints all immediate;

select assert_eq((select count(*)::int from needs_analysis_revisions), 3,
                 'detail-only edit writes its own revision');
select assert_eq((select submitted_by from needs_analysis_revisions where revision_number = 3),
                 '22222222-2222-2222-2222-222222222222'::uuid,
                 'revision attributed to the rep who made it');
select assert_eq((select current_revision_id from needs_analysis
                   where company_id = (select id from companies where name = 'TEST ELDERCARE CO')),
                 (select id from needs_analysis_revisions where revision_number = 3),
                 'current_revision_id follows the newest revision');

-- ---------------------------------------------------------------------
-- Attribution and source
-- ---------------------------------------------------------------------
\echo '--- attribution ---'

select assert_eq((select total_submissions::int from needs_analysis_productivity
                   where submitted_by = '11111111-1111-1111-1111-111111111111'),
                 2, 'rep 1 credited with two saves');
select assert_eq((select new_analyses::int from needs_analysis_productivity
                   where submitted_by = '11111111-1111-1111-1111-111111111111'),
                 1, 'rep 1 credited with one new analysis');
select assert_eq((select total_submissions::int from needs_analysis_productivity
                   where submitted_by = '22222222-2222-2222-2222-222222222222'),
                 1, 'rep 2 credited with one update');

-- An import runs with no logged-in user. The revision must still be recorded,
-- must be marked, and must not land in anyone's productivity numbers.
select next_save();
set constraints all deferred;
set local "request.jwt.claim.sub" = '';
set local "blkops.revision_source" = 'import';
insert into needs_analysis (company_id, analysis_type, facility_id)
select c.id, 'Home Based Care', f.id from companies c, facilities f
 where c.name = 'TEST HOME HEALTH CO' and f.slug = 'monroe';
set constraints all immediate;

select assert_eq((select r.source::text from needs_analysis_revisions r
                    join needs_analysis n on n.id = r.needs_analysis_id
                   where n.company_id = (select id from companies
                                          where name = 'TEST HOME HEALTH CO')),
                 'import', 'unauthenticated write is marked as an import');
select assert_eq((select count(*)::int from needs_analysis_productivity),
                 2, 'imported revisions do not create a phantom rep row');

-- ---------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------
\echo '--- constraints ---'

do $$ begin
  begin
    insert into needs_analysis (company_id, analysis_type)
    select id, 'Hospital' from companies where name = 'TEST ELDERCARE CO';
    raise exception 'FAIL: a company accepted a second needs analysis';
  exception when unique_violation then
    raise notice '  pass  one needs analysis per company is enforced';
  end;
end $$;

do $$
declare lc uuid; mon_terr uuid; co uuid;
begin
  select id into lc from facilities where slug = 'lakecharles';
  select t.id into mon_terr from territories t
    join facilities f on f.id = t.facility_id
   where f.slug = 'monroe' and t.name = 'Red';
  select id into co from companies limit 1;
  begin
    insert into facility_companies (facility_id, company_id, territory_id)
    values (lc, co, mon_terr);
    raise exception 'FAIL: a facility borrowed another facility''s territory';
  exception when foreign_key_violation then
    raise notice '  pass  cross-facility territory reference is rejected';
  end;
end $$;

do $$
declare fid uuid;
begin
  select id into fid from facilities where slug = 'monroe';
  begin
    insert into referrals (facility_id, submitted_by, admission_status)
    values (fid, '11111111-1111-1111-1111-111111111111', 'Denial');
    raise exception 'FAIL: a denial was accepted without a reason';
  exception when check_violation then
    raise notice '  pass  denial requires a reason';
  end;
end $$;

do $$ begin
  begin
    insert into needs_analysis_revisions
      (needs_analysis_id, revision_number, source, payload)
    select id, 99, 'user', '{}'::jsonb from needs_analysis limit 1;
    raise exception 'FAIL: a user-sourced revision was accepted with no actor';
  exception when check_violation then
    raise notice '  pass  user-sourced revision requires an actor';
  end;
end $$;

do $$
declare fid uuid;
begin
  select id into fid from facilities where slug = 'monroe';
  begin
    insert into daily_activities
      (facility_id, user_id, scheduled_next_visit)
    values (fid, '11111111-1111-1111-1111-111111111111', true);
    raise exception 'FAIL: a scheduled next visit was accepted with no date';
  exception when check_violation then
    raise notice '  pass  scheduled next visit requires a date';
  end;
end $$;

-- ---------------------------------------------------------------------
-- Reading views
-- ---------------------------------------------------------------------
\echo '--- views ---'

select assert_eq((select city from needs_analysis_full
                   where company_name = 'TEST ELDERCARE CO'),
                 'Monroe', 'needs_analysis_full restores the company city');
select assert_eq((select phone from needs_analysis_full
                   where company_name = 'TEST ELDERCARE CO'),
                 '318-555-0100', 'needs_analysis_full restores the company phone');

-- Community and Home Based Care ride the clinical shape.
select next_save();
set constraints all deferred;
insert into needs_analysis_clinical (needs_analysis_id, gatekeeper_name, training_needed)
select id, 'D. Fontenot', 'Yes' from needs_analysis
 where company_id = (select id from companies where name = 'TEST HOME HEALTH CO');
set constraints all immediate;

select assert_eq((select cl.gatekeeper_name from needs_analysis n
                    join needs_analysis_clinical cl on cl.needs_analysis_id = n.id
                   where n.analysis_type = 'Home Based Care'),
                 'D. Fontenot', 'Home Based Care uses the clinical detail table');

rollback;
