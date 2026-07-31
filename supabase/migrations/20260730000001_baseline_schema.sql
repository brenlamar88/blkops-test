-- =====================================================================
-- Black Ops CRM — schema
--
-- Values verified against the LIVE Gravity Forms on lakecharles.blkops.com.
-- Liveness was checked by newest entry date, not entry count:
--
--   form 113  New CRM Contact      7,523 entries, newest 2026-07-30  LIVE
--   form 55   ElderCare NA           360 entries, newest 2026-07-15  LIVE
--   form 114  Clinic/Practitioner     58 entries, newest 2026-07-16  LIVE
--   form 72   Hospital NA             35 entries                     LIVE
--   form 19   SDR Daily Activity   5,322 entries, newest 2020-02-20  DEAD
--   form 77   SDR Referral Log       168 entries, newest 2020-05-15  DEAD
--
-- Forms 19 and 77 carry identical entry counts on every install: they are
-- a frozen 2020 dataset duplicated when the sites were cloned. Activity
-- enums below come from form 113, which is the form actually in use.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------

create table organizations (
  id     uuid primary key default gen_random_uuid(),
  name   text not null,
  slug   text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table facilities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  slug            text not null,
  legacy_site_url text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, slug),
  unique (id, organization_id)
);

-- ---------------------------------------------------------------------
-- Enums (form 113)
-- ---------------------------------------------------------------------

create type unit_type as enum ('Inpatient Adult', 'Inpatient Geri', 'IOP');

-- form 113 field 27
create type contact_method as enum (
  'Rotation Schedule Visit', 'Maintenance Visit',
  'Missing in Service (M.I.S.) Visit', 'Telephone Call',
  'Referral Processing', 'Calendar Delivery'
);

-- form 113 field 28
create type activity_type as enum (
  'Quality Touch', 'Face to Face', 'Cold Call', 'In-Service', 'Luncheon',
  'Follow-Up', 'HWD Survey', 'Thank You''s', 'Pre Screen', 'Leave Behind'
);

-- form 135 field 87
create type admission_status as enum ('Admit', 'Denial', 'Pending');
create type recommendation_tier as enum ('Primary', 'Secondary', 'Tertiary');
create type mh_service_setting as enum ('Inpatient', 'Outpatient');
create type training_need as enum ('Yes', 'No', 'NA');
create type app_role as enum ('rep', 'manager', 'admin');

-- Where a revision came from. A migration script has no logged-in user, so
-- auth.uid() is null and the revision would otherwise be attributed to
-- nobody and silently counted as zero work. Marking the source keeps
-- imported history in the ledger without inflating or losing anyone's
-- numbers, and the check constraint below makes "a user save must have a
-- user" an invariant rather than an assumption.
create type revision_source as enum ('user', 'import', 'system');

-- Six intake forms, still two shapes.
--   facility shape  Eldercare, Hospital        beds, census, facility type
--   clinical shape  Practitioner, Mental Health, Community, Home Based Care
--
-- Community (law enforcement, courts, church groups) and Home Based Care
-- (home health, hospice, in-home) have no bed count and no facility type,
-- but they do have a gatekeeper, an office manager and a referral pathway —
-- which is exactly the clinical shape. Forms 151 and 153 have no entries, so
-- this is a modelling judgement rather than a transcription; moving either to
-- the facility table later is a detail-row migration, not a schema redesign.
create type needs_analysis_type as enum (
  'Eldercare', 'Hospital', 'Practitioner', 'Mental Health',
  'Community', 'Home Based Care'
);

create type eldercare_facility_type as enum (
  'Nursing Home', 'Assisted Living', 'Independent Living', 'Senior Housing'
);
create type hospital_facility_type as enum (
  'Acute Care', 'Critical Access', 'LTAC', 'Rehab', 'Freestanding ER', 'Urgent Care'
);

-- ---------------------------------------------------------------------
-- Staff and membership
-- ---------------------------------------------------------------------

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name  text,
  email      text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Role belongs to the membership, not the person: a rep at one facility can
-- be a manager at another, and a corporate user is simply a member of many.
create table facility_members (
  facility_id  uuid not null references facilities(id) on delete cascade,
  user_id      uuid not null references profiles(id)   on delete cascade,
  role         app_role not null default 'rep',
  territory_id uuid,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (facility_id, user_id)
);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, first_name, last_name)
  values (new.id, new.email,
          new.raw_user_meta_data ->> 'first_name',
          new.raw_user_meta_data ->> 'last_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- Lookups (organization-scoped)
-- ---------------------------------------------------------------------

create table categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null, sort_order int not null default 0,
  active boolean not null default true,
  unique (organization_id, name)
);

create table subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  name text not null, active boolean not null default true,
  unique (category_id, name)
);

create table practitioner_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null, active boolean not null default true,
  unique (organization_id, name)
);

create table contact_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null, active boolean not null default true,
  unique (organization_id, name)
);

create table payer_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null, sort_order int not null default 0,
  active boolean not null default true,
  unique (organization_id, name)
);

create table character_traits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null, active boolean not null default true,
  unique (organization_id, name)
);

create table denial_reasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null, sort_order int not null default 0,
  active boolean not null default true,
  unique (organization_id, name)
);

create table prescreen_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null, sort_order int not null default 0,
  active boolean not null default true,
  unique (organization_id, name)
);

-- form 113 field 29. `rank` 1 = coldest, ascending to preferred provider.
create table service_cycle_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null, rank int not null,
  short_label text,
  active boolean not null default true,
  unique (organization_id, name),
  unique (organization_id, rank)
);

-- Territories belong to a facility: Monroe's "Red" is not Lake Charles's "Red".
create table territories (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities(id) on delete cascade,
  name text not null, sort_order int not null default 0,
  active boolean not null default true,
  unique (facility_id, name),
  unique (id, facility_id)
);

alter table facility_members
  add constraint facility_members_territory_fk
  foreign key (territory_id, facility_id) references territories(id, facility_id);

-- ---------------------------------------------------------------------
-- Shared registry: one row per real-world account, per organization.
-- Territory is NOT here — it is a per-facility attribute, on the junction.
-- ---------------------------------------------------------------------

create table companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  category_id uuid references categories(id) on delete set null,
  subcategory_id uuid references subcategories(id) on delete set null,
  practitioner_type_id uuid references practitioner_types(id) on delete set null,
  address_line1 text, address_line2 text, city text, state text, zip text,
  website text, phone text, fax text, notes text,
  npi text,
  merged_into_id uuid references companies(id) on delete set null,
  active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint no_self_merge check (merged_into_id is null or merged_into_id <> id)
);

create index on companies (organization_id, lower(name));
create index on companies (merged_into_id) where merged_into_id is not null;

-- Which facility works which account, under which of its own territories.
create table facility_companies (
  facility_id uuid not null references facilities(id) on delete cascade,
  company_id  uuid not null references companies(id)  on delete cascade,
  territory_id uuid,
  active boolean not null default true,
  notes text,
  first_worked date,
  created_at timestamptz not null default now(),
  primary key (facility_id, company_id),
  foreign key (territory_id, facility_id) references territories(id, facility_id)
);

create index on facility_companies (company_id);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  first_name text not null, last_name text not null,
  role_id uuid references contact_roles(id) on delete set null,
  cell_phone text, office_phone text, fax text, email text,
  character_trait_1_id uuid references character_traits(id) on delete set null,
  character_trait_2_id uuid references character_traits(id) on delete set null,
  notes text,
  merged_into_id uuid references contacts(id) on delete set null,
  active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on contacts (company_id);

-- ---------------------------------------------------------------------
-- Daily activity — modelled on form 113 "New CRM Contact"
-- ---------------------------------------------------------------------

create table daily_activities (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete restrict,
  company_id uuid references companies(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  territory_id uuid,
  activity_date date not null default current_date,
  time_of_activity time,
  unit_type unit_type,
  type_of_contact contact_method,
  activity_type activity_type,
  service_cycle_stage_id uuid references service_cycle_stages(id) on delete set null,
  -- form 113 fields 30 and 31, captured as free text on the activity
  medical_director_name text,
  decision_maker_name text,
  -- form 113 field 38: one submission can represent several touches
  number_of_activities int not null default 1 check (number_of_activities > 0),
  scheduled_next_visit boolean not null default false,
  next_visit_date date,
  activity_information text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint next_visit_requires_date
    check (not scheduled_next_visit or next_visit_date is not null),
  foreign key (territory_id, facility_id) references territories(id, facility_id)
);

create index on daily_activities (facility_id, activity_date desc);
create index on daily_activities (user_id, activity_date desc);
create index on daily_activities (company_id);

create table eod_logs (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  log_date date not null default current_date,
  summary_notes text, miles_driven numeric(6,1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, log_date)
);

-- ---------------------------------------------------------------------
-- Referrals
--
-- Modelled on form 135 "SDR Daily Referral Reporting Log (1)", newest entry
-- 2026-07-30. This is a single shared form for every campus: field 89 is a
-- Campus selector listing all ten, which maps to facility_id here.
--
-- Patient identity stays capped at the form's own maxLength: 3 and 1.
-- ---------------------------------------------------------------------

create table referrals (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities(id) on delete cascade,
  referral_date date not null default current_date,
  time_of_submission time,
  submitted_by uuid not null references profiles(id) on delete restrict,
  territory_id uuid,
  patient_first_name varchar(3),
  patient_last_initial char(1),
  prospect_company_id uuid references companies(id) on delete set null,
  referral_contact_id uuid references contacts(id) on delete set null,
  -- City of referral is the referring company's city; read it through
  -- referrals_full rather than copying it onto every row.
  category_id uuid references categories(id) on delete set null,
  subcategory_id uuid references subcategories(id) on delete set null,
  referral_unit_type unit_type,
  primary_insurance_id uuid references payer_sources(id) on delete set null,
  primary_insurance_other text,
  secondary_insurance_id uuid references payer_sources(id) on delete set null,
  secondary_insurance_other text,
  prescreening_performed boolean not null default false,
  prescreen_location_id uuid references prescreen_locations(id) on delete set null,
  admission_status admission_status,
  -- form 135 field 88 is a single "ADMIT/DENIAL DATE", not two columns
  admit_denial_date date,
  denial_reason_id uuid references denial_reasons(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint denial_requires_reason
    check (admission_status is distinct from 'Denial' or denial_reason_id is not null),
  foreign key (territory_id, facility_id) references territories(id, facility_id)
);

create index on referrals (facility_id, referral_date desc);
create index on referrals (prospect_company_id);

-- ---------------------------------------------------------------------
-- Needs analysis: ONE live record per company, with a full revision ledger.
--
-- The unique constraint on company_id is the business rule. The revisions
-- table is append-only and is the productivity count — one row per save,
-- whether that save created the analysis or edited it.
-- ---------------------------------------------------------------------

create table needs_analysis (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references companies(id) on delete cascade,
  analysis_type needs_analysis_type not null,
  current_revision_id uuid,
  first_submitted_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  -- current state.
  -- Address, city, phone and fax deliberately absent: they belong to the
  -- company, and with one analysis per company, storing them here would both
  -- duplicate and drift. The revision ledger would also freeze a stale
  -- address into every snapshot. Read them through needs_analysis_full.
  territory_id uuid, facility_id uuid,
  unit_type unit_type,
  recommendation recommendation_tier,
  recommendation_reason text,
  summary_of_prospect text
);

create index on needs_analysis (recommendation);
create index on needs_analysis (analysis_type);

create table needs_analysis_facility (
  needs_analysis_id uuid primary key references needs_analysis(id) on delete cascade,
  eldercare_facility_type eldercare_facility_type,
  hospital_facility_type hospital_facility_type,
  number_of_beds int check (number_of_beds is null or number_of_beds >= 0),
  pct_psych_diagnosis numeric(5,2)
    check (pct_psych_diagnosis is null or pct_psych_diagnosis between 0 and 100),
  medical_director_notes text,
  other_practitioner_notes text
);

create table needs_analysis_clinical (
  needs_analysis_id uuid primary key references needs_analysis(id) on delete cascade,
  age_range_of_patients text,
  pct_psych_diagnosis numeric(5,2)
    check (pct_psych_diagnosis is null or pct_psych_diagnosis between 0 and 100),
  gatekeeper_name text, office_manager_name text, nurse_name text,
  mh_services_available mh_service_setting,
  primary_inpatient_choice text,
  training_needed training_need,
  how_become_primary text
);

create table needs_analysis_practitioners (
  id uuid primary key default gen_random_uuid(),
  needs_analysis_id uuid not null references needs_analysis(id) on delete cascade,
  practitioner_name text not null, specialty text, sort_order int not null default 0
);

create table needs_analysis_payer_sources (
  needs_analysis_id uuid not null references needs_analysis(id) on delete cascade,
  payer_source_id uuid not null references payer_sources(id) on delete cascade,
  is_primary boolean not null default false,
  primary key (needs_analysis_id, payer_source_id)
);

-- Append-only ledger. Never updated, never deleted.
create table needs_analysis_revisions (
  id uuid primary key default gen_random_uuid(),
  needs_analysis_id uuid not null references needs_analysis(id) on delete cascade,
  revision_number int not null,
  submitted_by uuid references profiles(id) on delete restrict,
  -- clock_timestamp(), not now(): now() is the transaction timestamp and is
  -- identical for every row written in one transaction. An import writing
  -- thousands of revisions would stamp them all the same instant, making the
  -- ledger unorderable. Each revision is a distinct event and gets a distinct
  -- time.
  submitted_at timestamptz not null default clock_timestamp(),
  source revision_source not null default 'user',
  facility_id uuid references facilities(id) on delete set null,
  is_initial boolean not null default false,
  -- promoted out of the payload because reports filter and rank on them
  recommendation recommendation_tier,
  analysis_type needs_analysis_type,
  payload jsonb not null,
  change_summary text,
  unique (needs_analysis_id, revision_number),
  constraint user_revision_needs_actor
    check (source <> 'user' or submitted_by is not null)
);

create index on needs_analysis_revisions (submitted_by, submitted_at desc);
create index on needs_analysis_revisions (source);
create index on needs_analysis_revisions (needs_analysis_id, revision_number desc);

alter table needs_analysis
  add constraint needs_analysis_current_revision_fk
  foreign key (current_revision_id) references needs_analysis_revisions(id)
  on delete set null;

-- ---------------------------------------------------------------------
-- Revision recording
--
-- One revision per analysis per transaction. The transaction-local guard
-- matters: a single logical save touches the base row and a detail row, and
-- without it each write would append its own revision and double every
-- rep's numbers.
-- ---------------------------------------------------------------------

create or replace function record_na_revision()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  na_id uuid;
  guard text;
  next_num int;
  actor uuid;
  src revision_source;
  base needs_analysis%rowtype;
  snapshot jsonb;
  rev_id uuid;
begin
  if TG_TABLE_NAME = 'needs_analysis' then
    na_id := NEW.id;
  else
    na_id := NEW.needs_analysis_id;
  end if;

  guard := 'blkops.na_' || replace(na_id::text, '-', '');
  if coalesce(current_setting(guard, true), '') = 'done' then
    return null;
  end if;
  perform set_config(guard, 'done', true);

  select * into base from needs_analysis where id = na_id;
  if not found then return null; end if;

  select coalesce(max(revision_number), 0) + 1 into next_num
    from needs_analysis_revisions where needs_analysis_id = na_id;

  -- An importer sets blkops.revision_source to 'import' and may also set the
  -- JWT subject to the rep the historical entry belonged to, so old work is
  -- attributed correctly while staying distinguishable from live entry.
  actor := auth.uid();
  src := coalesce(
    nullif(current_setting('blkops.revision_source', true), '')::revision_source,
    case when actor is null then 'system'::revision_source
         else 'user'::revision_source end);

  snapshot := jsonb_build_object(
    'base', to_jsonb(base),
    'facility_detail', (select to_jsonb(f) from needs_analysis_facility f
                          where f.needs_analysis_id = na_id),
    'clinical_detail', (select to_jsonb(c) from needs_analysis_clinical c
                          where c.needs_analysis_id = na_id),
    'practitioners', (select jsonb_agg(to_jsonb(p) order by p.sort_order)
                        from needs_analysis_practitioners p
                        where p.needs_analysis_id = na_id),
    'payer_sources', (select jsonb_agg(ps.payer_source_id)
                        from needs_analysis_payer_sources ps
                        where ps.needs_analysis_id = na_id)
  );

  insert into needs_analysis_revisions (
    needs_analysis_id, revision_number, submitted_by, source, facility_id,
    is_initial, recommendation, analysis_type, payload
  ) values (
    na_id, next_num, actor, src, base.facility_id,
    next_num = 1, base.recommendation, base.analysis_type, snapshot
  ) returning id into rev_id;

  update needs_analysis
     set current_revision_id = rev_id, last_updated_at = now()
   where id = na_id;

  return null;
end;
$$;

-- Deferred constraint triggers: these fire at COMMIT, not at statement time.
-- That matters. A single save updates the base row and then writes a detail
-- row; a non-deferred trigger would snapshot after the first write and miss
-- the second, recording a revision that never existed in that form. Deferring
-- means the snapshot is always the committed state, and the transaction-local
-- guard still collapses the whole save into one revision.
create constraint trigger na_revision_base
  after insert or update on needs_analysis
  deferrable initially deferred
  for each row execute function record_na_revision();

create constraint trigger na_revision_facility
  after insert or update on needs_analysis_facility
  deferrable initially deferred
  for each row execute function record_na_revision();

create constraint trigger na_revision_clinical
  after insert or update on needs_analysis_clinical
  deferrable initially deferred
  for each row execute function record_na_revision();

-- Reading views: restore the company-derived fields that are deliberately
-- not stored on the transactional rows.
create view needs_analysis_full as
  select n.*, c.name as company_name, c.city, c.address_line1, c.state,
         c.zip, c.phone, c.fax, c.category_id, c.subcategory_id
    from needs_analysis n
    join companies c on c.id = n.company_id;

create view referrals_full as
  select r.*, c.name as company_name, c.city, c.state, c.zip
    from referrals r
    left join companies c on c.id = r.prospect_company_id;

-- Submissions per rep, counting first entry and every edit.
-- Human submissions only. Imported and system-generated revisions stay in
-- the ledger for history but never count toward a rep's numbers.
create view needs_analysis_productivity as
  select r.submitted_by, r.facility_id,
         date_trunc('month', r.submitted_at) as month,
         count(*) filter (where r.is_initial)     as new_analyses,
         count(*) filter (where not r.is_initial) as updates,
         count(*)                                 as total_submissions
  from needs_analysis_revisions r
  where r.source = 'user'
  group by 1, 2, 3;

-- ---------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$
declare t text;
begin
  foreach t in array array['companies','contacts','daily_activities','eod_logs','referrals']
  loop
    execute format('create trigger touch_%1$s before update on %1$s
                      for each row execute function touch_updated_at()', t);
  end loop;
end $$;
