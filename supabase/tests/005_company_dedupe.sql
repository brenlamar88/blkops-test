-- =====================================================================
-- Company duplicate detection
-- Same shape as the others: plain SQL, one rolled-back transaction.
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

insert into companies (organization_id, name, address_line1, city)
select o.id, v.n, v.a, v.c from organizations o,
  (values
    ('Baton Rouge General', '100 Main St', 'Baton Rouge'),
    ('Sulphur Family Clinic', '55 Cypress Ave', 'Sulphur'),
    ('Dr. Jane Smith MD', '100 Main St', 'Baton Rouge'),
    ('Unique Wellness Center', '777 Solo St', 'Kinder')
  ) as v(n, a, c)
 where o.slug = 'fbh';

\echo '--- duplicate detection ---'

select assert(
  exists (select 1 from find_company_duplicates('Baton Rouge Genral') d
           where d.name = 'Baton Rouge General'),
  'a misspelled name is flagged');

select assert(
  not exists (select 1 from find_company_duplicates(
                'Community Outreach LLC', '999 Nowhere Rd', 'Elsewhere')),
  'an unrelated company is not flagged');

-- The multi-physician case: a different name at the same address is surfaced,
-- flagged as a same-address match (so the rep can confirm it's intentional).
select assert(
  exists (select 1 from find_company_duplicates('Dr. Bob Jones DO', '100 Main St', 'Baton Rouge') d
           where d.same_address and d.name = 'Baton Rouge General'),
  'a shared address is flagged as same_address');

-- Same street, different city → not a same-address match.
select assert(
  not exists (select 1 from find_company_duplicates('Totally New Co', '100 Main St', 'Lake Charles') d
               where d.same_address),
  'a matching street in a different city is not a same-address match');

-- Editing a company excludes itself, so it never flags as its own duplicate.
select assert(
  not exists (select 1 from find_company_duplicates(
                'Unique Wellness Center', '777 Solo St', 'Kinder',
                (select id from companies where name = 'Unique Wellness Center'))),
  'excluding self on edit drops the row');

rollback;
