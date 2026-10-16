-- =====================================================================
-- Company lifecycle status: name change and closed
--
-- A company is a shared registry row that activities, referrals and needs
-- analyses all reference, so an account that is renamed or shuts down must
-- not be deleted. `status` records which has happened; `former_name` keeps
-- the prior name after a rename so the "(formerly …)" label is preserved
-- for reference even though the display name is rewritten in place.
--
--   active       working account (default)
--   name_change  renamed — name now carries "(formerly <old name>)"
--   closed       no longer operating; kept for history, hidden by default
-- =====================================================================

alter table companies
  add column if not exists status text not null default 'active',
  add column if not exists former_name text;

alter table companies drop constraint if exists companies_status_check;
alter table companies add constraint companies_status_check
  check (status in ('active', 'name_change', 'closed'));

-- Refresh PostgREST's schema cache so the new columns are visible immediately.
notify pgrst, 'reload schema';
