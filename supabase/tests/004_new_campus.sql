-- =====================================================================
-- New campus seeding — territories and creator membership
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

create or replace function assert_eq(got anyelement, want anyelement, label text)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL: % (got %, want %)', label, got, want;
  end if;
  raise notice '  pass  %', label;
end $$;

insert into auth.users (id, email) values
  ('44444444-4444-4444-4444-444444444444', 'campusadmin@fbh.com');

\echo '--- new campus created in-app ---'
set local "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
insert into facilities (organization_id, name, slug)
select id, 'Test Campus', 'testcampus' from organizations where slug = 'fbh';

select assert_eq(
  (select count(*)::int from territories t
     join facilities f on f.id = t.facility_id where f.slug = 'testcampus'),
  4, 'a new campus is seeded with four territories');
select assert(
  exists (select 1 from territories t join facilities f on f.id = t.facility_id
           where f.slug = 'testcampus' and t.name = 'Gold'),
  'the seeded territories include Gold');
select assert_eq(
  (select role::text from facility_members m
     join facilities f on f.id = m.facility_id
    where f.slug = 'testcampus'
      and m.user_id = '44444444-4444-4444-4444-444444444444'),
  'admin', 'the creator becomes an admin of the campus they made');

\echo '--- campus seeded with no logged-in user (migration/import) ---'
set local "request.jwt.claim.sub" = '';
insert into facilities (organization_id, name, slug)
select id, 'Seed Campus', 'seedcampus' from organizations where slug = 'fbh';

select assert_eq(
  (select count(*)::int from territories t
     join facilities f on f.id = t.facility_id where f.slug = 'seedcampus'),
  4, 'a seeded campus still gets its territories');
select assert(
  not exists (select 1 from facility_members m
                join facilities f on f.id = m.facility_id where f.slug = 'seedcampus'),
  'no membership is invented when there is no logged-in creator');

rollback;
