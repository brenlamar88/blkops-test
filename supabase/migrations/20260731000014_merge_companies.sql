-- =====================================================================
-- merge_companies — fold a duplicate company into another (admin only)
--
-- Duplicates slip in (misspellings, abbreviations). This re-points everything
-- the loser owns onto the winner, then marks the loser merged and inactive so
-- it drops out of every list but its id still resolves. Because the app reads
-- references by company_id (not through merged_into_id), the child rows must
-- actually move.
--
--   activities, referrals, contacts  -> re-pointed to the winner
--   facility links                   -> moved, or dropped where the winner is
--                                       already linked to that campus
--   needs analysis                   -> left on the loser (hidden) to avoid
--                                       the one-per-company constraint and the
--                                       revision triggers; reported in the result
-- =====================================================================

create or replace function merge_companies(p_loser uuid, p_winner uuid)
returns json language plpgsql security definer set search_path = public as $$
declare o1 uuid; o2 uuid; acts int; refs int; cons int; fcs int; loser_na int;
begin
  if p_loser is null or p_winner is null or p_loser = p_winner then
    raise exception 'pick two different companies';
  end if;
  select organization_id into o1 from companies where id = p_loser;
  select organization_id into o2 from companies where id = p_winner;
  if o1 is null or o2 is null then raise exception 'company not found'; end if;
  if o1 <> o2 then raise exception 'companies are in different organizations'; end if;
  if not is_org_admin(o1) then raise exception 'company merge is admin-only'; end if;

  update daily_activities set company_id = p_winner where company_id = p_loser;
  get diagnostics acts = row_count;
  update referrals set prospect_company_id = p_winner where prospect_company_id = p_loser;
  get diagnostics refs = row_count;
  update contacts set company_id = p_winner where company_id = p_loser;
  get diagnostics cons = row_count;

  -- Move the loser's campus links to the winner, except where the winner is
  -- already linked to that campus (composite PK would collide); drop those.
  update facility_companies fc set company_id = p_winner
   where fc.company_id = p_loser
     and not exists (select 1 from facility_companies w
                      where w.company_id = p_winner and w.facility_id = fc.facility_id);
  get diagnostics fcs = row_count;
  delete from facility_companies where company_id = p_loser;

  -- Re-point any companies previously merged into the loser (merge chains).
  update companies set merged_into_id = p_winner where merged_into_id = p_loser;

  select count(*) into loser_na from needs_analysis where company_id = p_loser;

  update companies set merged_into_id = p_winner, active = false, updated_at = now()
   where id = p_loser;

  return json_build_object('activities_moved', acts, 'referrals_moved', refs,
    'contacts_moved', cons, 'facility_links_moved', fcs,
    'loser_needs_analysis_left', loser_na);
end $$;

grant execute on function merge_companies(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
