-- =====================================================================
-- Territory by city — behaviour tests
--
-- Covers the city → territory map and the auto-fill it drives on the daily
-- activity and referral forms: derivation, case/whitespace-insensitive
-- matching, the rep override, per-facility isolation, and the unmapped case.
-- Same shape as 001: plain SQL, one rolled-back transaction, raises on fail.
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

-- ---------------------------------------------------------------------
-- Fixtures: Lake Charles territories, a city map, and companies whose
-- cities exercise the exact match, the messy match, and no match.
-- ---------------------------------------------------------------------

-- Map two Lake Charles cities. 'Lake Charles' is stored title-case; the
-- company below carries it lower-case with trailing space on purpose.
insert into territory_cities (facility_id, city, territory_id)
select f.id, m.city, t.id
  from facilities f
  cross join (values ('Sulphur','Blue'), ('Lake Charles','Red')) as m(city, terr)
  join territories t on t.facility_id = f.id and t.name = m.terr
 where f.slug = 'lakecharles';

insert into companies (organization_id, name, category_id, city)
select o.id, n.name, c.id, n.city
  from organizations o
  join categories c on c.organization_id = o.id and c.name = 'Eldercare'
  join (values
    ('TC SULPHUR CO',      'Sulphur'),
    ('TC LAKECHARLES CO',  'lake charles '),   -- messy: case + trailing space
    ('TC IOWA CO',         'Iowa')             -- unmapped city
  ) as n(name, city) on true
 where o.slug = 'fbh';

\echo '--- resolver ---'
select assert_eq(
  territory_for_city((select id from facilities where slug='lakecharles'), 'SULPHUR'),
  (select t.id from territories t join facilities f on f.id=t.facility_id
    where f.slug='lakecharles' and t.name='Blue'),
  'territory_for_city matches case-insensitively');
select assert(
  territory_for_city((select id from facilities where slug='lakecharles'), 'Nowhere') is null,
  'territory_for_city returns null for an unmapped city');

-- ---------------------------------------------------------------------
-- Auto-fill on daily_activities
-- ---------------------------------------------------------------------
\echo '--- activity auto-fill ---'

insert into daily_activities (facility_id, source_rep_name, company_id, activity_date)
select f.id, 'TC REP', c.id, current_date
  from facilities f, companies c
 where f.slug='lakecharles' and c.name='TC SULPHUR CO';

select assert_eq(
  (select t.name from daily_activities a join territories t on t.id=a.territory_id
     join companies c on c.id=a.company_id where c.name='TC SULPHUR CO'),
  'Blue', 'activity territory derives from the company city');

-- Messy city string still resolves.
insert into daily_activities (facility_id, source_rep_name, company_id, activity_date)
select f.id, 'TC REP', c.id, current_date
  from facilities f, companies c
 where f.slug='lakecharles' and c.name='TC LAKECHARLES CO';

select assert_eq(
  (select t.name from daily_activities a join territories t on t.id=a.territory_id
     join companies c on c.id=a.company_id where c.name='TC LAKECHARLES CO'),
  'Red', 'auto-fill ignores case and surrounding whitespace');

-- Unmapped city leaves territory blank rather than guessing.
insert into daily_activities (facility_id, source_rep_name, company_id, activity_date)
select f.id, 'TC REP', c.id, current_date
  from facilities f, companies c
 where f.slug='lakecharles' and c.name='TC IOWA CO';

select assert(
  (select a.territory_id from daily_activities a join companies c on c.id=a.company_id
    where c.name='TC IOWA CO') is null,
  'an unmapped city leaves territory null');

-- A rep's explicit choice is never overwritten.
insert into daily_activities (facility_id, source_rep_name, company_id, territory_id, activity_date)
select f.id, 'TC REP', c.id, t.id, current_date
  from facilities f
  join territories t on t.facility_id=f.id and t.name='White'
  join companies c on c.name='TC SULPHUR CO'
 where f.slug='lakecharles';

select assert_eq(
  (select t.name from daily_activities a join territories t on t.id=a.territory_id
     join companies c on c.id=a.company_id
    where c.name='TC SULPHUR CO' and a.territory_id=t.id and t.name='White'),
  'White', 'a chosen territory is kept, not replaced by the city map');

-- ---------------------------------------------------------------------
-- Auto-fill on referrals, and per-facility isolation
-- ---------------------------------------------------------------------
\echo '--- referral auto-fill & isolation ---'

insert into referrals (facility_id, source_rep_name, prospect_company_id, referral_date)
select f.id, 'TC REP', c.id, current_date
  from facilities f, companies c
 where f.slug='lakecharles' and c.name='TC SULPHUR CO';

select assert_eq(
  (select t.name from referrals r join territories t on t.id=r.territory_id
     join companies c on c.id=r.prospect_company_id where c.name='TC SULPHUR CO'),
  'Blue', 'referral territory derives from the prospect company city');

-- Monroe has no map for Sulphur, so the Lake Charles map does not leak into it.
insert into referrals (facility_id, source_rep_name, prospect_company_id, referral_date)
select f.id, 'TC REP', c.id, current_date
  from facilities f, companies c
 where f.slug='monroe' and c.name='TC SULPHUR CO';

select assert(
  (select r.territory_id from referrals r join facilities f on f.id=r.facility_id
     join companies c on c.id=r.prospect_company_id
    where c.name='TC SULPHUR CO' and f.slug='monroe') is null,
  'one campus map does not resolve territory for another campus');

-- ---------------------------------------------------------------------
-- The map itself: one territory per city per facility
-- ---------------------------------------------------------------------
\echo '--- map constraints ---'

do $$
declare fid uuid; terr uuid;
begin
  select id into fid from facilities where slug='lakecharles';
  select t.id into terr from territories t where t.facility_id=fid and t.name='White';
  begin
    insert into territory_cities (facility_id, city, territory_id)
    values (fid, 'SULPHUR', terr);   -- same city, different case, same facility
    raise exception 'FAIL: a city was mapped twice within one facility';
  exception when unique_violation then
    raise notice '  pass  a city maps to one territory per facility';
  end;
end $$;

do $$
declare lc uuid; mon_terr uuid;
begin
  select id into lc from facilities where slug='lakecharles';
  select t.id into mon_terr from territories t join facilities f on f.id=t.facility_id
    where f.slug='monroe' and t.name='Red';
  begin
    insert into territory_cities (facility_id, city, territory_id)
    values (lc, 'Vinton', mon_terr);   -- Lake Charles borrowing Monroe's territory
    raise exception 'FAIL: a facility mapped a city to another facility''s territory';
  exception when foreign_key_violation then
    raise notice '  pass  the map rejects a cross-facility territory';
  end;
end $$;

rollback;
