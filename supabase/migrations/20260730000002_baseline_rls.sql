-- =====================================================================
-- Row level security — scoped by facility membership.
--
-- Reference data (companies, contacts, lookups) is readable across the
-- organization. Transactional data is readable only within facilities the
-- user belongs to.
-- =====================================================================

create or replace function my_facilities()
returns setof uuid language sql stable security definer set search_path = public as $$
  select facility_id from facility_members m
   join profiles p on p.id = m.user_id
  where m.user_id = auth.uid() and p.active
$$;

create or replace function my_orgs()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct f.organization_id
    from facility_members m
    join facilities f on f.id = m.facility_id
    join profiles p on p.id = m.user_id
   where m.user_id = auth.uid() and p.active
$$;

create or replace function is_admin_at(fid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from facility_members
                  where user_id = auth.uid() and facility_id = fid and role = 'admin')
$$;

create or replace function is_manager_at(fid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from facility_members
                  where user_id = auth.uid() and facility_id = fid
                    and role in ('manager','admin'))
$$;

create or replace function is_org_admin(oid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from facility_members m
                   join facilities f on f.id = m.facility_id
                  where m.user_id = auth.uid() and f.organization_id = oid
                    and m.role = 'admin')
$$;

-- --------------------------------------------------------------
-- Tenancy tables
-- --------------------------------------------------------------
alter table organizations enable row level security;
create policy org_read on organizations for select to authenticated
  using (id in (select my_orgs()));

alter table facilities enable row level security;
create policy fac_read on facilities for select to authenticated
  using (organization_id in (select my_orgs()));
create policy fac_write on facilities for all to authenticated
  using (is_org_admin(organization_id)) with check (is_org_admin(organization_id));

alter table facility_members enable row level security;
create policy fm_read on facility_members for select to authenticated
  using (facility_id in (select my_facilities()));
create policy fm_write on facility_members for all to authenticated
  using (is_admin_at(facility_id)) with check (is_admin_at(facility_id));

alter table profiles enable row level security;
create policy profiles_read on profiles for select to authenticated using (true);
create policy profiles_self on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- --------------------------------------------------------------
-- Org-scoped lookups: everyone in the org reads, org admins write.
-- --------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'categories','practitioner_types','contact_roles','payer_sources',
    'character_traits','denial_reasons','prescreen_locations','service_cycle_stages'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %1$s_read on %1$s for select to authenticated
                      using (organization_id in (select my_orgs()))', t);
    execute format('create policy %1$s_write on %1$s for all to authenticated
                      using (is_org_admin(organization_id))
                      with check (is_org_admin(organization_id))', t);
  end loop;
end $$;

-- Subcategories inherit their category's organization.
alter table subcategories enable row level security;
create policy sub_read on subcategories for select to authenticated
  using (exists (select 1 from categories c
                  where c.id = category_id and c.organization_id in (select my_orgs())));
create policy sub_write on subcategories for all to authenticated
  using (exists (select 1 from categories c
                  where c.id = category_id and is_org_admin(c.organization_id)))
  with check (exists (select 1 from categories c
                  where c.id = category_id and is_org_admin(c.organization_id)));

-- Territories are facility-scoped.
alter table territories enable row level security;
create policy terr_read on territories for select to authenticated
  using (facility_id in (select my_facilities()));
create policy terr_write on territories for all to authenticated
  using (is_admin_at(facility_id)) with check (is_admin_at(facility_id));

-- --------------------------------------------------------------
-- Shared registry: readable org-wide, writable by any active member.
-- Adding accounts from the field is the point of moving them out of a
-- hardcoded dropdown. Deletes are admin-only because they cascade.
-- --------------------------------------------------------------
alter table companies enable row level security;
create policy companies_read on companies for select to authenticated
  using (organization_id in (select my_orgs()));
create policy companies_insert on companies for insert to authenticated
  with check (organization_id in (select my_orgs()));
create policy companies_update on companies for update to authenticated
  using (organization_id in (select my_orgs()))
  with check (organization_id in (select my_orgs()));
create policy companies_delete on companies for delete to authenticated
  using (is_org_admin(organization_id));

alter table contacts enable row level security;
create policy contacts_read on contacts for select to authenticated
  using (exists (select 1 from companies c
                  where c.id = company_id and c.organization_id in (select my_orgs())));
create policy contacts_write on contacts for all to authenticated
  using (exists (select 1 from companies c
                  where c.id = company_id and c.organization_id in (select my_orgs())))
  with check (exists (select 1 from companies c
                  where c.id = company_id and c.organization_id in (select my_orgs())));

alter table facility_companies enable row level security;
create policy fc_read on facility_companies for select to authenticated
  using (facility_id in (select my_facilities()));
create policy fc_write on facility_companies for all to authenticated
  using (facility_id in (select my_facilities()))
  with check (facility_id in (select my_facilities()));

-- --------------------------------------------------------------
-- Transactional: facility-scoped. Own your rows; managers correct anyone's.
-- --------------------------------------------------------------
alter table daily_activities enable row level security;
create policy act_read on daily_activities for select to authenticated
  using (facility_id in (select my_facilities()));
create policy act_insert on daily_activities for insert to authenticated
  with check (facility_id in (select my_facilities())
              and (user_id = auth.uid() or is_manager_at(facility_id)));
create policy act_update on daily_activities for update to authenticated
  using (facility_id in (select my_facilities())
         and (user_id = auth.uid() or is_manager_at(facility_id)))
  with check (facility_id in (select my_facilities()));
create policy act_delete on daily_activities for delete to authenticated
  using (user_id = auth.uid() or is_manager_at(facility_id));

alter table eod_logs enable row level security;
create policy eod_read on eod_logs for select to authenticated
  using (facility_id in (select my_facilities()));
create policy eod_write on eod_logs for all to authenticated
  using (user_id = auth.uid() or is_manager_at(facility_id))
  with check (facility_id in (select my_facilities()));

alter table referrals enable row level security;
create policy ref_read on referrals for select to authenticated
  using (facility_id in (select my_facilities()));
create policy ref_insert on referrals for insert to authenticated
  with check (facility_id in (select my_facilities())
              and (submitted_by = auth.uid() or is_manager_at(facility_id)));
create policy ref_update on referrals for update to authenticated
  using (facility_id in (select my_facilities())
         and (submitted_by = auth.uid() or is_manager_at(facility_id)))
  with check (facility_id in (select my_facilities()));
create policy ref_delete on referrals for delete to authenticated
  using (is_manager_at(facility_id));

-- --------------------------------------------------------------
-- Needs analysis: one per company, shared org-wide like the company it
-- describes. Any member can update it; the ledger records who and when.
-- --------------------------------------------------------------
alter table needs_analysis enable row level security;
create policy na_read on needs_analysis for select to authenticated
  using (exists (select 1 from companies c
                  where c.id = company_id and c.organization_id in (select my_orgs())));
create policy na_write on needs_analysis for all to authenticated
  using (exists (select 1 from companies c
                  where c.id = company_id and c.organization_id in (select my_orgs())))
  with check (exists (select 1 from companies c
                  where c.id = company_id and c.organization_id in (select my_orgs())));

do $$
declare t text;
begin
  foreach t in array array[
    'needs_analysis_facility','needs_analysis_clinical',
    'needs_analysis_practitioners','needs_analysis_payer_sources'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy %1$s_all on %1$s for all to authenticated
        using (exists (select 1 from needs_analysis n join companies c on c.id = n.company_id
                where n.id = %1$s.needs_analysis_id
                  and c.organization_id in (select my_orgs())))
        with check (exists (select 1 from needs_analysis n join companies c on c.id = n.company_id
                where n.id = %1$s.needs_analysis_id
                  and c.organization_id in (select my_orgs())))$p$, t);
  end loop;
end $$;

-- The ledger is readable but never writable from the client. Only the
-- SECURITY DEFINER trigger appends to it, so productivity counts cannot be
-- edited by the people being measured.
alter table needs_analysis_revisions enable row level security;
create policy nar_read on needs_analysis_revisions for select to authenticated
  using (exists (select 1 from needs_analysis n join companies c on c.id = n.company_id
                  where n.id = needs_analysis_id
                    and c.organization_id in (select my_orgs())));
