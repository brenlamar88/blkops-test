-- =====================================================================
-- Company duplicate detection (soft warning)
--
-- Catches a prospective company that shares an address with an existing one,
-- or whose name is very similar / a likely misspelling, so a rep is warned
-- before creating a near-duplicate. It only *warns*: several physicians can
-- legitimately share a hospital's address, so the caller decides whether to
-- proceed. `companies.merged_into_id` remains the tool for collapsing any
-- duplicates that do get in.
-- =====================================================================

create extension if not exists pg_trgm;

-- Trigram index on the name for fast fuzzy lookups as the table grows.
create index if not exists companies_name_trgm
  on companies using gin (lower(name) gin_trgm_ops);

-- Likely duplicates of a prospective company. Invoker-rights (NOT security
-- definer) so the companies RLS policy still scopes results to the caller's
-- organization. search_path includes extensions because pg_trgm's similarity()
-- lives there on Supabase (and in public locally — a missing schema in the
-- path is simply ignored).
create or replace function find_company_duplicates(
  p_name      text,
  p_address   text default null,
  p_city      text default null,
  p_exclude   uuid default null,
  p_threshold real default 0.4
) returns table (
  id uuid, name text, address_line1 text, city text, phone text,
  score real, same_address boolean
) language sql stable
set search_path = public, extensions as $$
  select c.id, c.name, c.address_line1, c.city, c.phone,
         similarity(lower(c.name), lower(coalesce(p_name, ''))) as score,
         (btrim(coalesce(p_address, '')) <> ''
            and btrim(lower(coalesce(c.address_line1, ''))) = btrim(lower(p_address))
            and btrim(lower(coalesce(c.city, ''))) = btrim(lower(coalesce(p_city, '')))
         ) as same_address
    from companies c
   where c.active and c.merged_into_id is null
     and (p_exclude is null or c.id <> p_exclude)
     and (
       similarity(lower(c.name), lower(coalesce(p_name, ''))) >= p_threshold
       or (btrim(coalesce(p_address, '')) <> ''
           and btrim(lower(coalesce(c.address_line1, ''))) = btrim(lower(p_address))
           and btrim(lower(coalesce(c.city, ''))) = btrim(lower(coalesce(p_city, ''))))
     )
   order by same_address desc, score desc
   limit 8
$$;

grant execute on function find_company_duplicates(text, text, text, uuid, real) to authenticated;
