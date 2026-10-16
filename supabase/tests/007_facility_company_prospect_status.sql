-- =====================================================================
-- facility_companies.prospect_status — behaviour tests
--
-- The per-campus prospect tier is nullable and checked. Same shape as the
-- others: plain SQL, one rolled-back transaction, raises on fail.
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

\echo '--- facility_companies.prospect_status ---'

-- A company linked with a valid tier.
insert into companies (organization_id, name, category_id, city)
select o.id, 'TC TIER CO', c.id, 'Sulphur'
  from organizations o
  join categories c on c.organization_id = o.id and c.name = 'Eldercare'
 where o.slug = 'fbh';

insert into facility_companies (facility_id, company_id, prospect_status)
select f.id, c.id, 'Primary'
  from facilities f, companies c
 where f.slug = 'lakecharles' and c.name = 'TC TIER CO';

select assert(
  (select prospect_status from facility_companies fc join companies c on c.id=fc.company_id
    where c.name='TC TIER CO') = 'Primary',
  'a valid prospect tier is stored on the link');

-- Null is allowed (most links carry no tier).
update facility_companies set prospect_status = null
  where company_id = (select id from companies where name='TC TIER CO');
select assert(
  (select prospect_status from facility_companies fc join companies c on c.id=fc.company_id
    where c.name='TC TIER CO') is null,
  'a null prospect tier is allowed');

-- An unknown tier is rejected.
do $$
begin
  update facility_companies set prospect_status = 'Gold Star'
    where company_id = (select id from companies where name='TC TIER CO');
  raise exception 'FAIL: an invalid prospect tier was accepted';
exception when check_violation then
  raise notice '  pass  the prospect_status check rejects an unknown value';
end $$;

rollback;
