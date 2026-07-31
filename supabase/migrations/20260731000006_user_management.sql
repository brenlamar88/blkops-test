-- =====================================================================
-- User management: per-user menu visibility
--
-- Multiple campuses per user already works — facility_members is one row per
-- (facility, user) with the role on the membership, so a user is assigned to
-- many campuses by having many rows, and can be a rep at one and a manager at
-- another. No schema change is needed for that; the Users admin screen just
-- reads and writes facility_members, still gated by the existing
-- is_admin_at(facility_id) policy (a facility admin manages only their own
-- campuses).
--
-- What is new is per-user control over which menu items a person sees. A row
-- here hides one menu item for one user; absence means visible. Menu keys are
-- the nav route paths (e.g. '/reports'); Dashboard '/' is never hideable so a
-- user always has a landing page.
-- =====================================================================

create table user_menu_visibility (
  user_id    uuid not null references profiles(id) on delete cascade,
  menu_key   text not null,
  hidden     boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, menu_key),
  constraint menu_key_not_dashboard check (menu_key <> '/')
);

create index on user_menu_visibility (user_id) where hidden;

-- A user reads their own visibility to render their menu. A facility admin
-- reads and writes it for anyone who belongs to a campus they administer —
-- the same reach they have over that user's memberships.
alter table user_menu_visibility enable row level security;

create policy umv_read_self on user_menu_visibility for select to authenticated
  using (user_id = auth.uid());

create policy umv_admin_all on user_menu_visibility for all to authenticated
  using (exists (select 1 from facility_members fm
                  where fm.user_id = user_menu_visibility.user_id
                    and is_admin_at(fm.facility_id)))
  with check (exists (select 1 from facility_members fm
                  where fm.user_id = user_menu_visibility.user_id
                    and is_admin_at(fm.facility_id)));

create trigger touch_user_menu_visibility before update on user_menu_visibility
  for each row execute function touch_updated_at();
