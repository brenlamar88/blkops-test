-- =====================================================================
-- Seed the Lake Charles city → territory map from its companies.
--
-- Creates one territory_cities row per distinct company city (matched
-- case/whitespace-insensitively) for the Lake Charles campus, mapped to a
-- starting territory. Then refine the exceptions under Admin → Territory map:
-- change the cities that actually belong to Red / Blue / Gold.
--
-- Idempotent: cities you've already mapped are left exactly as they are, so
-- it's safe to re-run after you've started assigning real territories.
--
-- Change 'White' below to pick a different default landing territory.
-- =====================================================================

-- Optional preview — run this first to see the cities and how many companies
-- sit in each, so you know what you're mapping:
--
--   select btrim(city) as city, count(*) as companies
--     from companies
--    where active and merged_into_id is null and btrim(coalesce(city,'')) <> ''
--    group by btrim(city) order by companies desc;

insert into territory_cities (facility_id, city, territory_id)
select f.id, cl.city, t.id
  from facilities f
  join territories t on t.facility_id = f.id and t.name = 'White'   -- default territory
  cross join lateral (
    select distinct on (lower(btrim(c.city))) btrim(c.city) as city
      from companies c
     where c.organization_id = f.organization_id
       and c.active and c.merged_into_id is null
       and btrim(coalesce(c.city, '')) <> ''
     order by lower(btrim(c.city)), btrim(c.city)
  ) cl
 where f.slug = 'lakecharles'
on conflict (facility_id, lower(btrim(city))) do nothing;

-- How many cities are now mapped for Lake Charles:
select count(*) as lakecharles_cities_mapped
  from territory_cities tc
  join facilities f on f.id = tc.facility_id
 where f.slug = 'lakecharles';
