-- =====================================================================
-- merge_companies — behaviour tests
--
-- Folds a duplicate company into another: re-points activities, referrals,
-- contacts and campus links to the winner, then marks the loser merged and
-- inactive. Admin-only. Plain SQL, one rolled-back transaction.
-- =====================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
begin;

create or replace function assert(cond boolean, label text)
returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice '  pass  %', label;
end $$;

create or replace function assert_eq(got anyelement, want anyelement, label text)
returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL: % (got %, want %)', label, got, want; end if;
  raise notice '  pass  %', label;
end $$;

-- Admin user at Lake Charles.
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'mergeadmin@freedomhc.com');
insert into facility_members (user_id, facility_id, role)
select '55555555-5555-5555-5555-555555555555', id, 'admin' from facilities where slug='lakecharles';

-- Two duplicate companies; A is the misspelling we fold into B.
insert into companies (organization_id, name, category_id, city)
select o.id, n.name, c.id, 'Sulphur'
  from organizations o join categories c on c.organization_id=o.id and c.name='Eldercare'
  join (values ('TC MERGE A'),('TC MERGE B')) n(name) on true
 where o.slug='fbh';

-- Give A a campus link, an activity, a referral and a contact.
insert into facility_companies (facility_id, company_id)
select f.id, c.id from facilities f, companies c where f.slug='lakecharles' and c.name='TC MERGE A';
insert into daily_activities (facility_id, source_rep_name, company_id, activity_date)
select f.id, 'TC REP', c.id, current_date from facilities f, companies c where f.slug='lakecharles' and c.name='TC MERGE A';
insert into referrals (facility_id, source_rep_name, prospect_company_id, referral_date)
select f.id, 'TC REP', c.id, current_date from facilities f, companies c where f.slug='lakecharles' and c.name='TC MERGE A';
insert into contacts (company_id, first_name, last_name)
select id, 'Pat', 'Tester' from companies where name='TC MERGE A';

\echo '--- merge_companies ---'

-- Non-admin (no auth.uid()) is rejected.
do $$ begin
  begin
    perform merge_companies((select id from companies where name='TC MERGE A'),
                            (select id from companies where name='TC MERGE B'));
    raise exception 'FAIL: a non-admin merged companies';
  exception when others then
    if sqlerrm like '%admin-only%' then raise notice '  pass  merge_companies is admin-only';
    else raise; end if;
  end;
end $$;

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select merge_companies((select id from companies where name='TC MERGE A'),
                       (select id from companies where name='TC MERGE B'));

select assert_eq(
  (select name from companies c join daily_activities a on a.company_id=c.id where a.source_rep_name='TC REP'),
  'TC MERGE B', 'activity re-pointed to the winner');
select assert_eq(
  (select name from companies c join referrals r on r.prospect_company_id=c.id where r.source_rep_name='TC REP'),
  'TC MERGE B', 'referral re-pointed to the winner');
select assert_eq(
  (select name from companies c join contacts ct on ct.company_id=c.id where ct.last_name='Tester'),
  'TC MERGE B', 'contact re-pointed to the winner');
select assert_eq(
  (select c.name from companies c join facility_companies fc on fc.company_id=c.id
     join facilities f on f.id=fc.facility_id where f.slug='lakecharles' and c.name like 'TC MERGE%'),
  'TC MERGE B', 'campus link moved to the winner');
select assert(
  (select not active and merged_into_id = (select id from companies where name='TC MERGE B')
     from companies where name='TC MERGE A'),
  'the loser is inactive and points at the winner');

rollback;
