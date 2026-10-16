-- =====================================================================
-- Company lifecycle status — behaviour tests
--
-- Covers the status column default, the check constraint, and the
-- name-change convention of keeping the old name in former_name while the
-- display name carries "(formerly …)". Same shape as the others: plain SQL,
-- one rolled-back transaction, raises on fail.
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
  if got is distinct from want then
    raise exception 'FAIL: % (got %, want %)', label, got, want;
  end if;
  raise notice '  pass  %', label;
end $$;

\echo '--- company status ---'

-- A fresh company defaults to active with no former name.
insert into companies (organization_id, name, category_id, city)
select o.id, 'TC STATUS CO', c.id, 'Sulphur'
  from organizations o
  join categories c on c.organization_id = o.id and c.name = 'Eldercare'
 where o.slug = 'fbh';

select assert_eq(
  (select status from companies where name = 'TC STATUS CO'),
  'active', 'a new company defaults to active status');
select assert(
  (select former_name from companies where name = 'TC STATUS CO') is null,
  'a new company has no former_name');

-- The check constraint rejects an unknown status.
do $$
begin
  update companies set status = 'bogus' where name = 'TC STATUS CO';
  raise exception 'FAIL: an invalid status was accepted';
exception when check_violation then
  raise notice '  pass  the status check rejects an unknown value';
end $$;

-- A name change: display name carries "(formerly …)", former_name keeps the old.
update companies
   set name = 'TC RENAMED CO (formerly TC STATUS CO)',
       former_name = 'TC STATUS CO',
       status = 'name_change'
 where name = 'TC STATUS CO';

select assert_eq(
  (select status from companies where former_name = 'TC STATUS CO'),
  'name_change', 'a renamed company is marked name_change');
select assert(
  (select name from companies where former_name = 'TC STATUS CO') like '%(formerly TC STATUS CO)',
  'the display name carries the formerly suffix');

-- Closing is just another valid status.
update companies set status = 'closed' where former_name = 'TC STATUS CO';
select assert_eq(
  (select status from companies where former_name = 'TC STATUS CO'),
  'closed', 'a company can be marked closed');

rollback;
