-- =====================================================================
-- New campuses from the app
--
-- Facilities can already be inserted by an org admin (RLS fac_write =
-- is_org_admin), but a brand-new campus needs two things the creator's
-- client cannot do, because both are gated on being an admin *at that
-- facility* — which nobody is until it exists:
--
--   1. its four territories (Red/White/Blue/Gold), like every seeded campus
--   2. the creator as an admin member, so they can actually work the campus
--
-- A SECURITY DEFINER trigger does both with the needed privilege. Under a
-- migration or import there is no auth.uid(), so a seeded facility just gets
-- its territories and no phantom membership.
-- =====================================================================

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

create trigger on_facility_created after insert on facilities
  for each row execute function seed_new_facility();
