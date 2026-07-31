-- =====================================================================
-- Black Ops CRM — catch-up bundle
--
-- Applies every change made after the production baseline:
--   20260731000004  import attribution (nullable rep, source_rep_name, views)
--   20260731000005  territory by city (map, resolver, auto-fill triggers)
--   20260731000006  user management (per-user menu visibility)
--   20260731000007  new campuses (seed territories + creator admin trigger)
--
-- Idempotent: safe to run whether none, some, or all of these are already
-- applied, and safe to run twice. Paste the whole thing into the Supabase
-- SQL editor and run once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 000004  Import attribution
-- ---------------------------------------------------------------------
alter table daily_activities alter column user_id drop not null;
alter table daily_activities add column if not exists source_rep_name text;
alter table referrals alter column submitted_by drop not null;
alter table referrals add column if not exists source_rep_name text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'activity_has_an_actor') then
    alter table daily_activities add constraint activity_has_an_actor
      check (user_id is not null or source_rep_name is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'referral_has_an_actor') then
    alter table referrals add constraint referral_has_an_actor
      check (submitted_by is not null or source_rep_name is not null);
  end if;
end $$;

create index if not exists daily_activities_source_rep_name_idx
  on daily_activities (source_rep_name) where user_id is null;
create index if not exists referrals_source_rep_name_idx
  on referrals (source_rep_name) where submitted_by is null;

create or replace function actor_label(uid uuid, fallback text)
returns text language sql stable as $$
  select coalesce(
    (select nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '')
       from profiles p where p.id = uid),
    (select p.email from profiles p where p.id = uid),
    fallback,
    'Unknown')
$$;

create or replace view activity_by_rep as
  select a.facility_id,
         actor_label(a.user_id, a.source_rep_name) as rep,
         a.user_id,
         date_trunc('month', a.activity_date)      as month,
         count(*)                                   as entries,
         sum(a.number_of_activities)                as touches
  from daily_activities a
  group by 1, 2, 3, 4;

create or replace view referral_by_rep as
  select r.facility_id,
         actor_label(r.submitted_by, r.source_rep_name) as rep,
         r.submitted_by,
         date_trunc('month', r.referral_date)           as month,
         count(*)                                        as referrals,
         count(*) filter (where r.admission_status = 'Admit')  as admits,
         count(*) filter (where r.admission_status = 'Denial') as denials
  from referrals r
  group by 1, 2, 3, 4;

-- ---------------------------------------------------------------------
-- 000005  Territory by city
-- ---------------------------------------------------------------------
create table if not exists territory_cities (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references facilities(id) on delete cascade,
  city         text not null,
  territory_id uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint territory_cities_city_not_blank check (btrim(city) <> ''),
  foreign key (territory_id, facility_id) references territories(id, facility_id)
);

create unique index if not exists territory_cities_facility_city
  on territory_cities (facility_id, lower(btrim(city)));
create index if not exists territory_cities_territory_id_idx
  on territory_cities (territory_id);

drop trigger if exists touch_territory_cities on territory_cities;
create trigger touch_territory_cities before update on territory_cities
  for each row execute function touch_updated_at();

create or replace function territory_for_city(fid uuid, city_name text)
returns uuid language sql stable as $$
  select tc.territory_id
    from territory_cities tc
   where tc.facility_id = fid
     and lower(btrim(tc.city)) = lower(btrim(coalesce(city_name, '')))
   limit 1
$$;

create or replace function fill_territory_from_city()
returns trigger language plpgsql as $$
declare
  cid   uuid;
  ccity text;
begin
  if NEW.territory_id is not null then
    return NEW;
  end if;
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

drop trigger if exists fill_territory on daily_activities;
create trigger fill_territory before insert or update on daily_activities
  for each row execute function fill_territory_from_city();
drop trigger if exists fill_territory on referrals;
create trigger fill_territory before insert or update on referrals
  for each row execute function fill_territory_from_city();
drop trigger if exists fill_territory on facility_companies;
create trigger fill_territory before insert or update on facility_companies
  for each row execute function fill_territory_from_city();

alter table territory_cities enable row level security;
drop policy if exists tc_read on territory_cities;
create policy tc_read on territory_cities for select to authenticated
  using (facility_id in (select my_facilities()));
drop policy if exists tc_write on territory_cities;
create policy tc_write on territory_cities for all to authenticated
  using (is_admin_at(facility_id)) with check (is_admin_at(facility_id));

-- ---------------------------------------------------------------------
-- 000006  User management: per-user menu visibility
-- ---------------------------------------------------------------------
create table if not exists user_menu_visibility (
  user_id    uuid not null references profiles(id) on delete cascade,
  menu_key   text not null,
  hidden     boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, menu_key),
  constraint menu_key_not_dashboard check (menu_key <> '/')
);

create index if not exists user_menu_visibility_user_id_idx
  on user_menu_visibility (user_id) where hidden;

alter table user_menu_visibility enable row level security;
drop policy if exists umv_read_self on user_menu_visibility;
create policy umv_read_self on user_menu_visibility for select to authenticated
  using (user_id = auth.uid());
drop policy if exists umv_admin_all on user_menu_visibility;
create policy umv_admin_all on user_menu_visibility for all to authenticated
  using (exists (select 1 from facility_members fm
                  where fm.user_id = user_menu_visibility.user_id
                    and is_admin_at(fm.facility_id)))
  with check (exists (select 1 from facility_members fm
                  where fm.user_id = user_menu_visibility.user_id
                    and is_admin_at(fm.facility_id)));

drop trigger if exists touch_user_menu_visibility on user_menu_visibility;
create trigger touch_user_menu_visibility before update on user_menu_visibility
  for each row execute function touch_updated_at();


-- ---------------------------------------------------------------------
-- 000007  New campuses: seed territories + creator admin on facility insert
-- ---------------------------------------------------------------------
create or replace function seed_new_facility()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into territories (facility_id, name, sort_order)
  values (new.id, 'Red', 1), (new.id, 'White', 2),
         (new.id, 'Blue', 3), (new.id, 'Gold', 4)
  on conflict (facility_id, name) do nothing;

  if auth.uid() is not null then
    insert into facility_members (facility_id, user_id, role)
    values (new.id, auth.uid(), 'admin')
    on conflict (facility_id, user_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists on_facility_created on facilities;
create trigger on_facility_created after insert on facilities
  for each row execute function seed_new_facility();

-- Refresh PostgREST's schema cache so the new tables are visible immediately.
notify pgrst, 'reload schema';
