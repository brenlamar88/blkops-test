-- =====================================================================
-- Merge duplicate contacts (same company + same name)
--
-- "Duplicate" = same company AND the same first & last name, compared
-- case- and whitespace-insensitively. For each such group this keeps the
-- most complete record (then the oldest), moves any activities and referrals
-- from the extras onto the keeper, and marks the extras merged_into_id +
-- inactive.
--
-- Non-destructive and reversible: nothing is deleted, no history is lost, and
-- merged_into_id records where each duplicate went. Safe to re-run.
--
-- ---- PREVIEW FIRST (read-only) — see exactly what would be merged: --------
--   select comp.name as company,
--          btrim(c.first_name) || ' ' || btrim(c.last_name) as name,
--          count(*) as copies
--     from contacts c join companies comp on comp.id = c.company_id
--    where c.active and c.merged_into_id is null
--      and btrim(coalesce(c.first_name,'')) <> '' and btrim(coalesce(c.last_name,'')) <> ''
--    group by comp.name, lower(btrim(c.first_name)), lower(btrim(c.last_name)),
--             btrim(c.first_name), btrim(c.last_name)
--   having count(*) > 1
--    order by copies desc, company;
-- =====================================================================

begin;

create temporary table _contact_merge on commit drop as
with keyed as (
  select id, company_id,
         first_value(id) over (
           partition by company_id, lower(btrim(first_name)), lower(btrim(last_name))
           order by ((email is not null)::int + (cell_phone is not null)::int
                     + (office_phone is not null)::int + (role_id is not null)::int
                     + (notes is not null)::int) desc,      -- most complete wins
                    created_at asc, id asc                  -- then oldest
         ) as keeper_id
    from contacts
   where active and merged_into_id is null
     and btrim(coalesce(first_name, '')) <> ''
     and btrim(coalesce(last_name, '')) <> ''
)
select id, keeper_id from keyed where id <> keeper_id;

-- Move transactional references onto the keeper so no history is orphaned.
update daily_activities a set contact_id = m.keeper_id
  from _contact_merge m where a.contact_id = m.id;

update referrals r set referral_contact_id = m.keeper_id
  from _contact_merge m where r.referral_contact_id = m.id;

-- Retire the duplicates (kept, not deleted; merged_into_id points to the keeper).
update contacts c
   set merged_into_id = m.keeper_id, active = false
  from _contact_merge m where c.id = m.id;

select count(*) as contacts_merged from _contact_merge;

commit;
