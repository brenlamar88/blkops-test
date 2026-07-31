-- =====================================================================
-- Import attribution
--
-- daily_activities.user_id and referrals.submitted_by were NOT NULL, which
-- made historical data unimportable: entries name reps as free text, and a
-- former rep has no login. The importer was dropping every row it could not
-- match rather than losing attribution.
--
-- Losing the row is worse than losing the link. Both columns become nullable
-- and gain source_rep_name, which keeps the original text exactly as the old
-- form recorded it. Reporting reads whichever is present.
-- =====================================================================

alter table daily_activities
  alter column user_id drop not null,
  add column source_rep_name text;

alter table referrals
  alter column submitted_by drop not null,
  add column source_rep_name text;

-- A row must be attributable to somebody, even if only by name.
alter table daily_activities
  add constraint activity_has_an_actor
  check (user_id is not null or source_rep_name is not null);

alter table referrals
  add constraint referral_has_an_actor
  check (submitted_by is not null or source_rep_name is not null);

create index on daily_activities (source_rep_name) where user_id is null;
create index on referrals (source_rep_name) where submitted_by is null;

-- Who did the work, whether or not they have a login. Use this for rep
-- reporting instead of joining profiles directly.
create or replace function actor_label(uid uuid, fallback text)
returns text language sql stable as $$
  select coalesce(
    (select nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '')
       from profiles p where p.id = uid),
    (select p.email from profiles p where p.id = uid),
    fallback,
    'Unknown')
$$;

create view activity_by_rep as
  select a.facility_id,
         actor_label(a.user_id, a.source_rep_name) as rep,
         a.user_id,
         date_trunc('month', a.activity_date)      as month,
         count(*)                                   as entries,
         sum(a.number_of_activities)                as touches
  from daily_activities a
  group by 1, 2, 3, 4;

create view referral_by_rep as
  select r.facility_id,
         actor_label(r.submitted_by, r.source_rep_name) as rep,
         r.submitted_by,
         date_trunc('month', r.referral_date)           as month,
         count(*)                                        as referrals,
         count(*) filter (where r.admission_status = 'Admit')  as admits,
         count(*) filter (where r.admission_status = 'Denial') as denials
  from referrals r
  group by 1, 2, 3, 4;
