// Mirrors the Postgres enums, which came from the live forms:
//   form 113 "New CRM Contact"                  activity capture
//   form 135 "SDR Daily Referral Reporting Log (1)"  referrals
export const UNIT_TYPES = ['Inpatient Adult', 'Inpatient Geri', 'IOP']

export const CONTACT_METHODS = [
  'Rotation Schedule Visit', 'Maintenance Visit',
  'Missing in Service (M.I.S.) Visit', 'Telephone Call',
  'Referral Processing', 'Calendar Delivery',
]

export const ACTIVITY_TYPES = [
  'Quality Touch', 'Face to Face', 'Cold Call', 'In-Service', 'Luncheon',
  'Follow-Up', 'HWD Survey', "Thank You's", 'Pre Screen', 'Leave Behind',
]

export const ADMISSION_STATUSES = ['Admit', 'Pending', 'Denial']
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

// Six intake forms, two detail shapes.
export const NA_SHAPE = {
  Eldercare: 'facility',
  Hospital: 'facility',
  Practitioner: 'clinical',
  'Mental Health': 'clinical',
  Community: 'clinical',
  'Home Based Care': 'clinical',
}
