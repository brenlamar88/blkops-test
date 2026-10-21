// Mirrors the Postgres enums, which came from the live forms:
//   form 113 "New CRM Contact"                  activity capture
//   form 135 "SDR Daily Referral Reporting Log (1)"  referrals
export const UNIT_TYPES = ['Inpatient Adult', 'Inpatient Geri', 'Inpatient Adol', 'IOP']

export const CONTACT_METHODS = [
  'Rotation Schedule Visit', 'Maintenance Visit',
  'Missing in Service (M.I.S.) Visit', 'Telephone Call',
  'Referral Processing', 'Calendar Delivery',
]

export const ACTIVITY_TYPES = [
  'Quality Touch', 'Face to Face', 'Cold Call', 'In-Service', 'Luncheon',
  'Follow-Up', 'HWD Survey', "Thank You's", 'Pre Screen', 'Leave Behind',
]

// Mirrors the Postgres admission_status enum. 'Pending' remains a valid DB
// value for historical rows but is retired from the UI — new referrals are
// either decided (Admit/Denial) or left undecided (null, "Not decided").
export const ADMISSION_STATUSES = ['Admit', 'Pending', 'Denial']

// Outcomes offered in the referral form and the referral-list filter.
export const REFERRAL_OUTCOMES = ['Admit', 'Denial']
export const RECOMMENDATIONS = ['Primary', 'Secondary', 'Tertiary']
export const MH_SETTINGS = ['Inpatient', 'Outpatient']
export const TRAINING_NEEDS = ['Yes', 'No', 'NA']

export const ELDERCARE_FACILITY_TYPES = [
  'Nursing Home', 'Assisted Living', 'Independent Living', 'Senior Housing',
]
export const HOSPITAL_FACILITY_TYPES = [
  'Acute Care', 'Critical Access', 'LTAC', 'Rehab', 'Freestanding ER', 'Urgent Care',
]

export const NA_TYPES = [
  'Eldercare', 'Hospital', 'Practitioner', 'Mental Health',
  'Community', 'Home Based Care',
]

// Company lifecycle status (companies.status — a checked text column, not a
// Postgres enum type). Value → display label.
export const COMPANY_STATUSES = {
  active: 'Active',
  name_change: 'Name change',
  closed: 'Closed',
}

// Per-campus prospect tier on facility_companies.prospect_status (a checked
// text column). How important a referral source is to that campus.
export const PROSPECT_STATUSES = ['Potential Primary', 'Primary', 'Secondary']

// Six intake forms, two detail shapes.
export const NA_SHAPE = {
  Eldercare: 'facility',
  Hospital: 'facility',
  Practitioner: 'clinical',
  'Mental Health': 'clinical',
  Community: 'clinical',
  'Home Based Care': 'clinical',
}
