-- =====================================================================
-- Per-campus prospect tier on the facility↔company link
--
-- How important a referral source is to a campus — "Potential Primary",
-- "Primary", "Secondary" — is a property of the relationship, not of the
-- shared company, so it lives on facility_companies alongside territory. The
-- same account can be Primary for one campus and Secondary for another.
-- Nullable: most links won't have a tier set.
-- =====================================================================

alter table facility_companies add column if not exists prospect_status text;

alter table facility_companies drop constraint if exists facility_companies_prospect_status_check;
alter table facility_companies add constraint facility_companies_prospect_status_check
  check (prospect_status is null or prospect_status in ('Potential Primary', 'Primary', 'Secondary'));

notify pgrst, 'reload schema';
