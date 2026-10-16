-- =====================================================================
-- merge_city — fold one city spelling into another, org-wide.
--
-- City lives on the shared companies row and drives territory (via the
-- per-facility territory_cities map). A misspelling therefore fragments the
-- data AND can break territory resolution. This function renames every
-- company whose city matches p_old (case/space-insensitively) to p_new,
-- re-derives the territory on the affected facility links from the new city,
-- and drops any now-orphaned city->territory map rows for the old spelling.
--
-- Admin-only (checked inside; SECURITY DEFINER so it can touch the shared
-- registry and the map under one authority). Returns the number of companies
-- renamed. Idempotent: merging a city into itself, or re-running, is a no-op.
-- =====================================================================

create or replace function merge_city(p_old text, p_new text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if btrim(coalesce(p_old, '')) = '' or btrim(coalesce(p_new, '')) = '' then
    raise exception 'both old and new city are required';
  end if;
  if not exists (
    select 1 from facility_members m
     where m.user_id = auth.uid() and m.role = 'admin') then
    raise exception 'city merge is admin-only';
  end if;

  -- 1. Rename the shared company rows (only in orgs the caller administers).
  update companies c
     set city = btrim(p_new)
   where upper(btrim(c.city)) = upper(btrim(p_old))
     and is_org_admin(c.organization_id);
  get diagnostics n = row_count;

  -- 2. Re-derive territory on links whose company now carries the new city,
  --    where that city is mapped for the facility (blanks are left alone).
  update facility_companies fc
     set territory_id = territory_for_city(fc.facility_id, p_new)
    from companies c
   where fc.company_id = c.id
     and upper(btrim(c.city)) = upper(btrim(p_new))
     and territory_for_city(fc.facility_id, p_new) is not null
     and fc.territory_id is distinct from territory_for_city(fc.facility_id, p_new);

  -- 3. Drop now-orphaned map rows for the old spelling (no company uses it).
  delete from territory_cities tc
   where upper(btrim(tc.city)) = upper(btrim(p_old))
     and tc.facility_id in (select my_facilities())
     and not exists (
       select 1 from companies c2
         join facilities f on f.id = tc.facility_id
        where upper(btrim(c2.city)) = upper(btrim(tc.city))
          and c2.organization_id = f.organization_id);

  return n;
end $$;

grant execute on function merge_city(text, text) to authenticated;

notify pgrst, 'reload schema';
