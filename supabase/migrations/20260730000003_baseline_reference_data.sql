-- =====================================================================
-- Seed: one organization, the ten facility installs, and the lookup
-- values transcribed from the live forms. Idempotent.
-- =====================================================================

insert into organizations (name, slug) values ('Freedom Behavioral Health', 'fbh')
on conflict (slug) do nothing;

insert into facilities (organization_id, name, slug, legacy_site_url)
select o.id, f.name, f.slug, 'https://' || f.slug || '.blkops.com'
from organizations o, (values
  ('DeQuincy','dequincy'), ('Greenville','greenville'), ('Lake Charles','lakecharles'),
  ('Leesville','leesville'), ('Magnolia','magnolia'), ('Many','many'),
  ('Minden','minden'), ('Monroe','monroe'), ('Ville Platte','villeplatte'),
  ('Plainview','plainview')
) as f(name, slug)
where o.slug = 'fbh'
on conflict (organization_id, slug) do nothing;

-- Territories are per facility. Gold is included everywhere: it is a real
-- territory, but the live referral form (77 field 79) offers only Red,
-- White and Blue — so that form cannot record a Gold referral today.
insert into territories (facility_id, name, sort_order)
select f.id, t.name, t.sort_order
from facilities f, (values ('Red',1),('White',2),('Blue',3),('Gold',4)) as t(name, sort_order)
on conflict (facility_id, name) do nothing;

-- form 113 field 9
insert into categories (organization_id, name, sort_order)
select o.id, c.name, c.sort_order from organizations o, (values
  ('Eldercare',1),('Hospitals',2),('Practitioners',3),
  ('Mental Health',4),('Home Based Care',5),('Community',6)
) as c(name, sort_order) where o.slug='fbh'
on conflict (organization_id, name) do nothing;

-- form 135 field 85 "TYPE OF SUBCATEGORY" is one flat list of 30; the
-- category each belongs to is inferred. Form 19 carried per-category lists
-- with different values (ADULT DAY CARE, MENTAL HEALTH NH, Nurse
-- Practitioners, General Practice) but that form died in 2020, so the live
-- form wins where they disagree.
insert into subcategories (category_id, name)
select c.id, s.name from (values
  ('Eldercare','Nursing Homes'),('Eldercare','Assisted Living'),
  ('Eldercare','Senior Apartments'),('Eldercare','Independent Living'),
  ('Hospitals','Acute Care'),('Hospitals','Critical Access'),('Hospitals','LTAC'),
  ('Hospitals','Rehab'),('Hospitals','Freestanding ER'),('Hospitals','Urgent Care'),
  ('Practitioners','Psychiatrist'),('Practitioners','Primary Care'),
  ('Practitioners','Internal Med'),('Practitioners','Family Practice'),
  ('Mental Health','LSMSW'),('Mental Health','LMSW'),('Mental Health','LPC''s'),
  ('Mental Health','Partial Hospitalization Programs'),
  ('Mental Health','Intensive Outpatient Programs'),('Mental Health','Psychologist'),
  ('Mental Health','Crisis Centers'),('Mental Health','Commitment Resource'),
  ('Home Based Care','Medical'),('Home Based Care','Psych'),
  ('Home Based Care','In Home Care'),
  ('Community','Law Enforcement'),('Community','Chancery Courts'),
  ('Community','Church Groups')
) as s(category, name)
join categories c on c.name = s.category
join organizations o on o.id = c.organization_id and o.slug = 'fbh'
on conflict (category_id, name) do nothing;

insert into practitioner_types (organization_id, name)
select o.id, x.name from organizations o, (values
  ('ADDICTION MEDICINE'),('CLINICAL NURSE SPECIALIST'),('CRITICAL CARE (INTENSIVISTS)'),
  ('EMERGENCY MEDICINE'),('FAMILY PRACTICE'),('GERIATRIC PSYCHIATRY'),
  ('INFECTIOUS DISEASE'),('INTERNAL MEDICINE'),('NEUROLOGY'),('NURSE PRACTITIONER'),
  ('OBSTETRICS/GYNECOLOGY'),('OCCUPATIONAL THERAPY'),('OPHTHALMOLOGY'),
  ('PHYSICAL MEDICINE AND REHABILITATION'),('PHYSICAL THERAPY'),
  ('PHYSICIAN ASSISTANT'),('PREVENTATIVE MEDICINE'),('PSYCHIATRY')
) as x(name) where o.slug='fbh'
on conflict (organization_id, name) do nothing;

insert into payer_sources (organization_id, name, sort_order)
select o.id, p.name, p.n from organizations o, (values
  ('ACS - CAPROCK',1),('ACS - HEALTHSMART',2),('ACS - MULTIPLAN',3),('AETNA',4),
  ('AMERIGROUP (AMERIVANTAGE)',5),('APS (UNIVERSAL AMERICAN)',6),
  ('BLUE CROSS BLUE SHIELD',7),('CARE N CARE',8),('CENPATICO (SUPERIOR)',9),
  ('CIGNA',10),('FIRST CARE',11),('HEALTHSPRING (BRAVO)',12),('HUMANA (LIFESYNCH)',13),
  ('MAGELLAN',14),('MEDICAID',15),('MEDICARE',16),('NONE',17),('PACIFICARE (UHC)',18),
  ('PRIVATE PAY',19),('TRICARE',20),('UBH/OPTUM -  CARE IMPROVEMENT',21),
  ('UBH/OPTUM -  SECURE HORIZONS',22),('UBH/OPTUM -  STAR + PLUS MCD',23),
  ('VALUE OPTIONS',24),('VERITY',25),('VANTAGE',26),('WELLCARE',27),
  ('UNITED HEALTH CARE',28),('SERVICE CONNECTED',29)
) as p(name, n) where o.slug='fbh'
on conflict (organization_id, name) do nothing;

insert into denial_reasons (organization_id, name, sort_order)
select o.id, d.name, d.n from organizations o, (values
  ('ADMINISTRATIVE',1),('AGE INAPPROPRIATE',2),('COVID PROTOCOLS',3),
  ('EXCLUSIONARY CRITERIA',4),('EXHAUSTED DAYS',5),('FAMILY REFUSED',6),
  ('MAX CAP FOR COVID RESTRICTIONS',7),('MEDICAL',8),('NEED DETOX PROTOCAL',9),
  ('NO IMMEDIATE BED AVAILABILTY',10),('PATIENT REFUSED',11),('PLACED ELSEWHERE',12),
  ('PRIVATE PAY DECLINED',13),('PRIMARY CD',14),('PSYCHIATRIST',15),
  ('PHYSICIAN (MEDICAL)',16),('UNIT AQUITY',17)
) as d(name, n) where o.slug='fbh'
on conflict (organization_id, name) do nothing;

insert into prescreen_locations (organization_id, name, sort_order)
select o.id, l.name, l.n from organizations o, (values
  ('REFERRAL SOURCE SITE',1),('AT OUR HOSPITAL',2),
  ('NONE REQUIRED DUE TO COMMITMENT',3),('OVER THE PHONE BY CLINICIAN',4)
) as l(name, n) where o.slug='fbh'
on conflict (organization_id, name) do nothing;

insert into character_traits (organization_id, name)
select o.id, t.name from organizations o,
  (values ('Talker'),('Doer'),('Plodder'),('Controller')) as t(name)
where o.slug='fbh'
on conflict (organization_id, name) do nothing;

-- form 113 field 29, verbatim. `short_label` is for table columns and chart
-- axes, where the full sentence will not fit.
--
-- Note ranks 1 and 2: the live form carries two near-identical options,
-- "Contact prospect has voiced will never utilize our services" and
-- "Contact has voiced will never utilize our services". Both are seeded so
-- existing entries map cleanly. One should almost certainly be retired.
insert into service_cycle_stages (organization_id, name, rank, short_label)
select o.id, s.name, s.rank, s.short from organizations o, (values
  ('Contact has voiced will never utilize our services', 1, 'Will never utilize'),
  ('Contact prospect has voiced will never utilize our services', 2, 'Prospect will never utilize'),
  ('Contact knows of our service line but uses another service line', 3, 'Uses a competitor'),
  ('Contact has utilized our service line in the past, but no within the last 6 months', 4, 'Lapsed 6+ months'),
  ('Contact has used our service line multiple times in past 6 months', 5, 'Active, 6 months'),
  ('Contact has used our service line multiple times in last 90 days', 6, 'Active, 90 days'),
  ('Contact utilizes our services as the preferred provider', 7, 'Preferred provider')
) as s(name, rank, short) where o.slug='fbh'
on conflict (organization_id, name) do nothing;

-- Inferred, not transcribed: no live form exposes a contact role list.
insert into contact_roles (organization_id, name)
select o.id, r.name from organizations o, (values
  ('Administrator'),('CEO'),('Director of Nursing (DON)'),('Case Management Director'),
  ('Case Manager'),('Discharge Planner'),('Social Services Director'),
  ('Medical Director'),('ER Supervisor'),('Gatekeeper'),('Office Manager'),
  ('RN'),('LPN'),('CNA'),('Admissions Director'),('Business Development'),
  ('Marketing Director'),('Executive Director'),('Owner'),('Practice Manager'),
  ('Referral Coordinator'),('Other')
) as r(name) where o.slug='fbh'
on conflict (organization_id, name) do nothing;
