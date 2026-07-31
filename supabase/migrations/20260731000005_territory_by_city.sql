-- =====================================================================
-- Territory by city
--
-- Territory is a per-facility attribute — Monroe's "Red" is not Lake
-- Charles's "Red", enforced by the composite (territory_id, facility_id)
-- foreign keys — and companies are a shared registry, one row per real
-- account across all ten campuses. Those two facts together are why
-- territory cannot be a column on companies (the original bug): a company
-- two campuses both work would need two different territories.
--
-- Instead each facility maps the cities it works to one of its own
-- territories. A company's territory is then a function of
-- (facility, company.city), derived rather than stored on the company —
-- and the daily activity and referral forms fill it in from the city of
-- the company on the entry. A rep can still override it; auto-fill only
-- ever writes into a blank territory, never over a chosen one.
--
-- Editing a city's territory is a data edit (update the map), not a code
-- change. Re-mapping a city changes future auto-fills only; already-logged
-- activities and referrals keep the territory they were stamped with,
-- because a transactional row is a point-in-time record.
-- =====================================================================

create table territory_cities (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references facilities(id) on delete cascade,
  city         text not null,
  territory_id uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint territory_cities_city_not_blank check (btrim(city) <> ''),
  -- The territory must belong to this facility, same guard the transactional
  -- tables carry. A campus cannot map a city to another campus's territory.
  foreign key (territory_id, facility_id) references territories(id, facility_id)
);

-- One territory per city per facility, matched case- and edge-whitespace
-- insensitively so "Lake Charles", "lake charles " and "LAKE CHARLES" are one.
create unique index territory_cities_facility_city
  on territory_cities (facility_id, lower(btrim(city)));
create index on territory_cities (territory_id);

create trigger touch_territory_cities before update on territory_cities
  for each row execute function touch_updated_at();

-- Resolve a facility + free-text city to its mapped territory, or null.
-- Plain (not SECURITY DEFINER): it runs as the caller, and a rep may read
-- the map for any facility they belong to — which is exactly the facility an
-- entry they are writing is scoped to. Imports run as the service role and
-- bypass RLS entirely.
create or replace function territory_for_city(fid uuid, city_name text)
returns uuid language sql stable as $$
  select tc.territory_id
    from territory_cities tc
   where tc.facility_id = fid
     and lower(btrim(tc.city)) = lower(btrim(coalesce(city_name, '')))
   limit 1
$$;

-- Fill territory_id from the entry company's city when the rep left it blank.
-- One function for all three tables; only the company column differs.
create or replace function fill_territory_from_city()
returns trigger language plpgsql as $$
declare
  cid   uuid;
  ccity text;
begin
  if NEW.territory_id is not null then
    return NEW;                       -- a chosen territory always wins
  end if;

  -- Separate IF branches, not a CASE expression: PL/pgSQL resolves a record
  -- field only when that statement runs, so the referrals trigger never
  -- touches NEW.company_id (which its record has no field for) and vice versa.
  if TG_TABLE_NAME = 'referrals' then
    cid := NEW.prospect_company_id;
  else
    cid := NEW.company_id;
  end if;
  if cid is null then
    return NEW;
  end if;

  select city into ccity from companies where id = cid;
  NEW.territory_id := territory_for_city(NEW.facility_id, ccity);
  return NEW;
end;
$$;

create trigger fill_territory before insert or update on daily_activities
  for each row execute function fill_territory_from_city();
create trigger fill_territory before insert or update on referrals
  for each row execute function fill_territory_from_city();
create trigger fill_territory before insert or update on facility_companies
  for each row execute function fill_territory_from_city();

-- Facility-scoped, same posture as territories: members read, admins write.
alter table territory_cities enable row level security;
create policy tc_read on territory_cities for select to authenticated
  using (facility_id in (select my_facilities()));
create policy tc_write on territory_cities for all to authenticated
  using (is_admin_at(facility_id)) with check (is_admin_at(facility_id));
