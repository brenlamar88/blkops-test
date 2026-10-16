-- =====================================================================
-- merge_city — behaviour tests
--
-- Folds one city spelling into another: renames the shared company rows,
-- re-derives territory from the new city, and is admin-only. Same shape as
-- the others: plain SQL, one rolled-back transaction, raises on fail.
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

-- An admin user at Lake Charles (handle_new_user makes the profile).
insert into auth.users (id, email) values
  ('44444444-4444-4444-4444-444444444444', 'cityadmin@freedomhc.com');
insert into facility_members (user_id, facility_id, role)
select '44444444-4444-4444-4444-444444444444', id, 'admin' from facilities where slug='lakecharles';

-- Map the CORRECT spelling; create a company carrying the TYPO.
insert into territory_cities (facility_id, city, territory_id)
select f.id, 'EUNICE', t.id from facilities f
  join territories t on t.facility_id=f.id and t.name='White' where f.slug='lakecharles';

insert into companies (organization_id, name, category_id, city)
select o.id, 'TC EUNICE CO', c.id, 'EUINCE'
  from organizations o join categories c on c.organization_id=o.id and c.name='Eldercare'
 where o.slug='fbh';

insert into facility_companies (facility_id, company_id)
select f.id, c.id from facilities f, companies c where f.slug='lakecharles' and c.name='TC EUNICE CO';

\echo '--- merge_city ---'

-- The typo city is unmapped, so territory starts blank.
select assert(
  (select territory_id from facility_companies fc join companies c on c.id=fc.company_id
    where c.name='TC EUNICE CO') is null,
  'the misspelled city leaves territory unresolved');

-- Act as the admin and merge.
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select assert_eq(merge_city('EUINCE','EUNICE'), 1, 'merge reports one company renamed');

select assert_eq(
  (select city from companies where name='TC EUNICE CO'), 'EUNICE',
  'merge renames the company city');
select assert_eq(
  (select t.name from facility_companies fc
     join territories t on t.id=fc.territory_id
     join companies c on c.id=fc.company_id where c.name='TC EUNICE CO'),
  'White', 'merge re-derives territory from the corrected city');

-- A non-admin (no auth.uid()) is rejected.
reset request.jwt.claim.sub;
do $$ begin
  begin
    perform merge_city('EUNICE', 'ANYTHING');
    raise exception 'FAIL: a non-admin was allowed to merge cities';
  exception when others then
    if sqlerrm like '%admin-only%' then raise notice '  pass  merge_city is admin-only';
    else raise; end if;
  end;
end $$;

rollback;
