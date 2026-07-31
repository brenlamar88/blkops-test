#!/usr/bin/env node
/**
 * Import Gravity Forms CSV exports into the Black Ops schema.
 *
 *   node scripts/import.mjs --campus lakecharles              # dry run
 *   node scripts/import.mjs --campus lakecharles --commit     # actually write
 *
 * Reads CSVs from ./import-data/<campus>/ named:
 *   companies.csv        form 124  CRM Company
 *   contacts.csv         form 123  CRM Contact
 *   activities.csv       form 113  New CRM Contact
 *   referrals.csv        form 135  SDR Daily Referral Reporting Log (1)
 *   needs-*.csv          forms 55 / 72 / 114 / 152  (any file starting "needs-")
 *
 * Every file is optional — it imports whatever is present.
 *
 * Needs a service role key, because row level security would otherwise block
 * writes that have no logged-in user:
 *   export SUPABASE_URL=https://xxxx.supabase.co
 *   export SUPABASE_SERVICE_KEY=eyJ...
 *
 * That key bypasses all security. Keep it out of git and never ship it to a
 * browser. It is only used here, on your machine, for this one job.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const arg = (n, d) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : d }
const CAMPUS = arg('--campus')
const COMMIT = args.includes('--commit')
const DIR = join(process.cwd(), 'import-data', CAMPUS ?? '')

if (!CAMPUS) { console.error('Missing --campus, e.g. --campus lakecharles'); process.exit(1) }
if (!existsSync(DIR)) { console.error(`No such folder: ${DIR}`); process.exit(1) }

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_KEY
if (!URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY first. See the header of this file.')
  process.exit(1)
}
const db = createClient(URL, KEY, { auth: { persistSession: false } })

/* ---------- CSV ---------- */
// Gravity Forms exports comma-separated with quoted fields and embedded
// newlines inside notes, so a split(',') will silently corrupt rows.
function parseCsv(text) {
  const rows = []
  let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  if (!rows.length) return []
  const head = rows[0].map((h) => h.trim())
  return rows.slice(1)
    .filter((r) => r.some((x) => x && x.trim()))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])))
}

if (args.includes('--headers')) {
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.csv'))) {
    const rows = parseCsv(readFileSync(join(DIR, f), 'utf8').replace(/^\uFEFF/, ''))
    console.log(`\n${f}  (${rows.length} rows)`)
    Object.keys(rows[0] ?? {}).forEach((h, i) => console.log(`  ${String(i).padStart(3)}  ${h}`))
  }
  process.exit(0)
}

const load = (file) => {
  const p = join(DIR, file)
  if (!existsSync(p)) return null
  return parseCsv(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
}

// Gravity Forms column headers are the field labels, which drift between sites
// and over time. Match loosely on a few candidate substrings rather than
// requiring an exact header.
const pick = (row, ...cands) => {
  for (const c of cands) {
    const k = Object.keys(row).find((h) => h.toLowerCase().includes(c.toLowerCase()))
    if (k && row[k]) return row[k].trim()
  }
  return null
}

const norm = (s) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// Enum columns reject anything not in their list, and Gravity Forms writes
// placeholder text ("Select One", "OTHER", "-- Fill Out Other Fields --") when
// a dropdown was left alone. Whitelist against the real values rather than
// guessing at every placeholder the forms might contain.
const UNIT_TYPES = ['Inpatient Adult', 'Inpatient Geri', 'IOP']
const CONTACT_METHODS = ['Rotation Schedule Visit', 'Maintenance Visit',
  'Missing in Service (M.I.S.) Visit', 'Telephone Call',
  'Referral Processing', 'Calendar Delivery']
const ACTIVITY_TYPES = ['Quality Touch', 'Face to Face', 'Cold Call', 'In-Service',
  'Luncheon', 'Follow-Up', 'HWD Survey', "Thank You's", 'Pre Screen', 'Leave Behind']

const rejected = {}
const enumOf = (allowed, v, label) => {
  if (!v) return null
  const n = norm(v)
  const hit = allowed.find((a) => norm(a) === n)
    ?? allowed.find((a) => norm(a).startsWith(n) && n.length > 4)
    ?? allowed.find((a) => n.startsWith(norm(a)) && norm(a).length > 4)
  if (!hit) {
    const k = `${label}: "${v}"`
    rejected[k] = (rejected[k] ?? 0) + 1
  }
  return hit ?? null
}
const date = (s) => {
  if (!s) return null
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  return iso ? iso[0] : null
}
const num = (s) => { const n = parseFloat(String(s ?? '').replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n }

/* ---------- reference data ---------- */
const stats = {}
const bump = (k, n = 1) => { stats[k] = (stats[k] ?? 0) + n }
const warn = []

async function all(table, cols = '*') {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

console.log(`\nCampus: ${CAMPUS}   mode: ${COMMIT ? 'COMMIT' : 'dry run'}\n`)

const [org] = await all('organizations', 'id,slug')
const facilities = await all('facilities', 'id,slug,name')
const facility = facilities.find((f) => f.slug === CAMPUS)
if (!facility) { console.error(`No facility with slug "${CAMPUS}".`); process.exit(1) }

const categories = await all('categories', 'id,name')
const subcategories = await all('subcategories', 'id,name,category_id')
const territories = (await all('territories', 'id,name,facility_id'))
  .filter((t) => t.facility_id === facility.id)
const contactRoles = await all('contact_roles', 'id,name')
const traits = await all('character_traits', 'id,name')
const payers = await all('payer_sources', 'id,name')
const denials = await all('denial_reasons', 'id,name')
const prescreens = await all('prescreen_locations', 'id,name')
const stages = await all('service_cycle_stages', 'id,name,short_label')
const profiles = await all('profiles', 'id,email,first_name,last_name')

const byName = (list, v) => {
  if (!v) return null
  const n = norm(v)
  const hit = list.find((x) => norm(x.name) === n)
    ?? list.find((x) => norm(x.name).startsWith(n) || n.startsWith(norm(x.name)))
  return hit?.id ?? null
}
const stageId = (v) => {
  if (!v) return null
  const n = norm(v)
  return (stages.find((s) => norm(s.name) === n)
    ?? stages.find((s) => norm(s.short_label ?? '') === n)
    ?? stages.find((s) => norm(s.name).includes(n) && n.length > 8))?.id ?? null
}
// Historical entries name a rep as free text. Match to a real account where
// possible; otherwise leave null and mark the revision as an import.
const repId = (v) => {
  if (!v) return null
  const n = norm(v)
  return profiles.find((p) => norm(`${p.first_name ?? ''}${p.last_name ?? ''}`) === n
    || norm(p.email.split('@')[0]) === n)?.id ?? null
}

/* ---------- 1. companies ---------- */
const companyRows = load('companies.csv') ?? []
const companyIdByName = new Map()
;(await all('companies', 'id,name')).forEach((c) => companyIdByName.set(norm(c.name), c.id))

const newCompanies = []
const seen = new Set()
for (const r of companyRows) {
  const name = pick(r, 'company name', 'name')
  if (!name) { bump('companies skipped (no name)'); continue }
  const key = norm(name)
  if (seen.has(key)) { bump('companies skipped (duplicate in file)'); continue }
  seen.add(key)
  if (companyIdByName.has(key)) { bump('companies already present'); continue }

  const catId = byName(categories, pick(r, 'company category', 'category'))
  const subId = catId
    ? byName(subcategories.filter((s) => s.category_id === catId), pick(r, 'subcategor'))
    : null
  newCompanies.push({
    organization_id: org.id, name,
    category_id: catId, subcategory_id: subId,
    address_line1: pick(r, 'address (street', 'street address', 'address'),
    city: pick(r, 'address (city', 'city'),
    state: pick(r, 'address (state', 'state'),
    zip: pick(r, 'address (zip', 'zip'),
    website: pick(r, 'website'),
    phone: pick(r, 'business phone', 'phone'),
    fax: pick(r, 'business fax', 'fax'),
  })
}
bump('companies to insert', newCompanies.length)

/* ---------- 2. contacts ---------- */
const contactRows = load('contacts.csv') ?? []
const newContacts = []
for (const r of contactRows) {
  const co = pick(r, 'prospect company', 'company')
  const first = pick(r, 'name (first', 'first name', 'first')
  const last = pick(r, 'name (last', 'last name', 'last')
  if (!co || !first || !last) { bump('contacts skipped (incomplete)'); continue }
  newContacts.push({ _company: norm(co), first_name: first, last_name: last,
    role_id: byName(contactRoles, pick(r, 'role')),
    cell_phone: pick(r, 'cell phone', 'cell'),
    email: pick(r, 'email'),
    character_trait_1_id: byName(traits, pick(r, 'character trait 1')),
    character_trait_2_id: byName(traits, pick(r, 'character trait 2')) })
}
bump('contacts to insert', newContacts.length)

/* ---------- 3. activities ---------- */
const activityRows = load('activities.csv') ?? []
const newActivities = []
for (const r of activityRows) {
  const stated = date(pick(r, 'date of activity'))
  const entered = date(pick(r, 'entry date', 'date created', 'created'))
  const d = stated ?? entered
  if (!d) { bump('activities skipped (no usable date at all)'); continue }
  if (!stated) bump('activities using entry date (activity date was blank)')
  newActivities.push({ _company: norm(pick(r, 'company name', 'company') ?? ''),
    facility_id: facility.id,
    _rep: pick(r, 'entry username', 'submitted by'),
    activity_date: d,
    time_of_activity: (pick(r, 'time of activity') ?? '').match(/^\d{1,2}:\d{2}/)?.[0] ?? null,
    unit_type: enumOf(UNIT_TYPES, pick(r, 'unit type'), 'unit type'),
    type_of_contact: enumOf(CONTACT_METHODS, pick(r, 'type of contact'), 'type of contact'),
    activity_type: enumOf(ACTIVITY_TYPES, pick(r, 'activity type'), 'activity type'),
    service_cycle_stage_id: stageId(pick(r, 'stages of service', 'stage')),
    medical_director_name: pick(r, 'medical director'),
    decision_maker_name: pick(r, 'decision maker'),
    number_of_activities: Math.max(1, Math.round(num(pick(r, 'number of activities')) ?? 1)),
    territory_id: byName(territories, pick(r, 'territory')),
    activity_information: pick(r, 'activity information', 'comments'),
    ...(() => {
      const said = /^y/i.test(pick(r, 'scheduled next visit') ?? '')
      const when = date(pick(r, 'date scheduled next', 'next visit'))
      if (said && !when) bump('next visit marked yes but no date recorded')
      return { scheduled_next_visit: said && !!when, next_visit_date: when }
    })(),
  })
}
bump('activities to insert', newActivities.length)

/* ---------- 4. referrals ---------- */
const referralRows = load('referrals.csv') ?? []
const newReferrals = []
for (const r of referralRows) {
  const d = date(pick(r, 'date of referral', 'date'))
    ?? date(pick(r, 'entry date', 'date created'))
  if (!d) { bump('referrals skipped (no usable date at all)'); continue }
  const status = (() => {
    const s = (pick(r, 'admission status') ?? '').toLowerCase()
    if (s.startsWith('admit')) return 'Admit'
    if (s.startsWith('den')) return 'Denial'
    if (s.startsWith('pend')) return 'Pending'
    return null
  })()
  const denialId = byName(denials, pick(r, 'denial reason'))
  newReferrals.push({ _company: norm(pick(r, 'prospect name', 'company') ?? ''),
    facility_id: facility.id,
    _rep: pick(r, 'referral submitted by', 'submitted by'),
    referral_date: d,
    time_of_submission: (pick(r, 'time of referral') ?? '').match(/^\d{1,2}:\d{2}/)?.[0] ?? null,
    patient_first_name: (pick(r, 'first name') ?? '').slice(0, 3) || null,
    patient_last_initial: (pick(r, 'last name') ?? '').slice(0, 1) || null,
    territory_id: byName(territories, pick(r, 'territory')),
    category_id: byName(categories, pick(r, 'category of referral', 'category')),
    referral_unit_type: enumOf(UNIT_TYPES, pick(r, 'unit type'), 'referral unit type'),
    primary_insurance_id: byName(payers, pick(r, 'primary insurance')),
    secondary_insurance_id: byName(payers, pick(r, 'secondary insurance')),
    prescreening_performed: /^y/i.test(pick(r, 'prescreening performed') ?? ''),
    prescreen_location_id: byName(prescreens, pick(r, 'prescreening activity location')),
    // The schema rejects a denial with no reason. Rather than dropping the row,
    // downgrade to Pending and flag it — losing a referral is worse than
    // losing one field, and these are reviewable afterwards.
    admission_status: status === 'Denial' && !denialId ? 'Pending' : status,
    denial_reason_id: status === 'Denial' ? denialId : null,
    admit_denial_date: date(pick(r, 'admit/denial date', 'admit date')),
    notes: pick(r, 'comments'),
    _downgraded: status === 'Denial' && !denialId,
  })
}
bump('referrals to insert', newReferrals.length)
bump('referrals downgraded to Pending (denial reason unmatched)',
     newReferrals.filter((r) => r._downgraded).length)

/* ---------- 5. needs analysis ---------- */
// One per company. Multiple historical entries for the same company become
// one record plus a revision chain, oldest first, so the ledger reads as the
// account's real history rather than a pile of duplicates.
const needsFiles = readdirSync(DIR).filter((f) => /^needs-.*\.csv$/i.test(f))
const naByCompany = new Map()
for (const f of needsFiles) {
  const type = (f.match(/^needs-(.+)\.csv$/i)?.[1] ?? '').toLowerCase()
  const analysisType =
    type.includes('elder') ? 'Eldercare' :
    type.includes('hosp') ? 'Hospital' :
    type.includes('clinic') || type.includes('pract') ? 'Practitioner' :
    type.includes('mental') ? 'Mental Health' :
    type.includes('commun') ? 'Community' :
    type.includes('home') ? 'Home Based Care' : null
  if (!analysisType) { warn.push(`Skipped ${f} — cannot tell which form it is from the filename.`); continue }

  for (const r of load(f) ?? []) {
    const co = norm(pick(r, 'company name', 'company') ?? '')
    if (!co) { bump('needs analysis skipped (no company)'); continue }
    const entry = {
      analysisType, when: date(pick(r, 'date')) ?? '1970-01-01',
      rep: pick(r, 'submitted by', 'entry username'),
      recommendation: ['Primary', 'Secondary', 'Tertiary']
        .find((x) => (pick(r, 'recommendation') ?? '').toLowerCase().startsWith(x.toLowerCase())) ?? null,
      recommendation_reason: pick(r, 'why'),
      unit_type: enumOf(UNIT_TYPES, pick(r, 'unit type'), 'needs analysis unit type'),
      facilityDetail: {
        number_of_beds: Math.round(num(pick(r, 'number of beds', 'beds')) ?? 0) || null,
        pct_psych_diagnosis: num(pick(r, 'psych dia', 'psych dx')),
        medical_director_notes: pick(r, 'medical director'),
      },
      clinicalDetail: {
        age_range_of_patients: pick(r, 'age range'),
        pct_psych_diagnosis: num(pick(r, 'psych dx', 'psych dia')),
        gatekeeper_name: pick(r, 'gate keeper', 'gatekeeper'),
        office_manager_name: pick(r, 'office manager'),
        nurse_name: pick(r, 'nurse'),
        primary_inpatient_choice: pick(r, 'primary choice for inpatient'),
        how_become_primary: pick(r, 'how can we become'),
      },
    }
    if (!naByCompany.has(co)) naByCompany.set(co, [])
    naByCompany.get(co).push(entry)
  }
}
for (const list of naByCompany.values()) list.sort((a, b) => a.when.localeCompare(b.when))
bump('needs analyses (unique companies)', naByCompany.size)
bump('needs analysis revisions to replay',
     [...naByCompany.values()].reduce((n, l) => n + l.length, 0))

const repNames = [...new Set([...newActivities, ...newReferrals]
  .map((r) => r._rep).filter(Boolean))]
const unmatchedReps = repNames.filter((n) => !repId(n))

/* ---------- pre-flight ----------
   Every CHECK constraint in the schema, enforced here so a bad row is
   corrected or reported up front instead of killing a 500-row batch. --- */
const fixed = {}
const note = (k) => { fixed[k] = (fixed[k] ?? 0) + 1 }

for (const a of newActivities) {
  if (a.scheduled_next_visit && !a.next_visit_date) {
    a.scheduled_next_visit = false; note('next visit flag cleared (no date)')
  }
  if (!(a.number_of_activities > 0)) { a.number_of_activities = 1; note('activity count defaulted to 1') }
  if (!a.activity_date) { a.activity_date = null; note('activity missing date') }
}

for (const r of newReferrals) {
  if (r.admission_status === 'Denial' && !r.denial_reason_id) {
    r.admission_status = 'Pending'; note('denial without a reason downgraded to Pending')
  }
  if (r.patient_first_name) r.patient_first_name = r.patient_first_name.slice(0, 3)
  if (r.patient_last_initial) r.patient_last_initial = r.patient_last_initial.slice(0, 1)
}

for (const list of naByCompany.values()) {
  for (const e of list) {
    for (const d of [e.facilityDetail, e.clinicalDetail]) {
      if (d.pct_psych_diagnosis != null && (d.pct_psych_diagnosis < 0 || d.pct_psych_diagnosis > 100)) {
        d.pct_psych_diagnosis = null; note('psych percentage out of range, cleared')
      }
      if (d.number_of_beds != null && d.number_of_beds < 0) {
        d.number_of_beds = null; note('negative bed count cleared')
      }
    }
  }
}

/* ---------- report ---------- */
console.log('Planned:')
for (const [k, v] of Object.entries(stats)) console.log(`  ${String(v).padStart(6)}  ${k}`)
const fixedList = Object.entries(fixed).sort((a, b) => b[1] - a[1])
if (fixedList.length) {
  console.log('\nCorrected before writing:')
  for (const [k, n] of fixedList) console.log(`  ${String(n).padStart(6)}  ${k}`)
}
const rejectedList = Object.entries(rejected).sort((a, b) => b[1] - a[1])
if (rejectedList.length) {
  console.log('\nDropdown values that are not valid options (stored as blank):')
  for (const [k, n] of rejectedList.slice(0, 15)) {
    console.log(`  ${String(n).padStart(6)}  ${k}`)
  }
  if (rejectedList.length > 15) console.log(`  … and ${rejectedList.length - 15} more kinds`)
  console.log('  These are placeholders or retired options. The rows still import.')
}
if (repNames.length) {
  console.log(`\nReps named in the data (${repNames.length}):`)
  for (const n of repNames.slice(0, 30)) {
    console.log(`  ${repId(n) ? '[linked]  ' : '[no login]'} ${n}`)
  }
  if (repNames.length > 30) console.log(`  … and ${repNames.length - 30} more`)
  if (unmatchedReps.length) {
    console.log(`\n  ${unmatchedReps.length} have no user account. Their work is still`)
    console.log('  imported and still shows their name; it just is not linked to a login.')
  }
}
if (warn.length) { console.log('\nWarnings:'); warn.forEach((w) => console.log('  - ' + w)) }

if (!COMMIT) {
  console.log('\nDry run — nothing written. Re-run with --commit to apply.\n')
  process.exit(0)
}

/* ---------- write ---------- */
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
async function insert(table, rows, label) {
  let done = 0, failed = 0
  for (const part of chunk(rows, 500)) {
    const { data, error } = await db.from(table).insert(part).select('id')
    if (!error) { done += data.length }
    else {
      // Retry the batch one row at a time so one bad record costs one record.
      for (const one of part) {
        const r = await db.from(table).insert(one).select('id')
        if (r.error) {
          failed++
          if (failed <= 5) warn.push(`${label}: ${r.error.message}`)
        } else done++
      }
    }
    process.stdout.write(`\r  ${label}: ${done}/${rows.length}`)
  }
  if (failed) warn.push(`${label}: ${failed} rows could not be written`)
  console.log('')
}

console.log('\nWriting…')

if (newCompanies.length) {
  await insert('companies', newCompanies, 'companies')
  ;(await all('companies', 'id,name')).forEach((c) => companyIdByName.set(norm(c.name), c.id))
}

// Link every account to this campus.
const links = [...companyIdByName.values()].map((company_id) => ({
  facility_id: facility.id, company_id,
}))
for (const part of chunk(links, 500)) {
  await db.from('facility_companies').upsert(part, { onConflict: 'facility_id,company_id' })
}
console.log(`  linked ${links.length} accounts to ${facility.name}`)

const resolve = (rows, label) => {
  const ok = [], missing = []
  for (const r of rows) {
    const id = companyIdByName.get(r._company)
    if (!id && r._company) { missing.push(r._company); continue }
    const { _company, _rep, _downgraded, ...rest } = r
    ok.push({ ...rest, ...(label === 'contacts' ? { company_id: id }
      : label === 'referrals'
        ? { prospect_company_id: id, submitted_by: repId(_rep), source_rep_name: _rep || 'Unknown' }
        : { company_id: id, user_id: repId(_rep), source_rep_name: _rep || 'Unknown' }) })
  }
  if (missing.length) warn.push(`${label}: ${missing.length} rows had a company not in the registry`)
  return ok
}

if (newContacts.length) await insert('contacts', resolve(newContacts, 'contacts'), 'contacts')

// Rows whose rep has no login keep the original name in source_rep_name
// rather than being dropped. A former rep will never have an account, and
// losing the activity is worse than losing the link to a profile.
const acts = resolve(newActivities, 'activities')
const refs = resolve(newReferrals, 'referrals')
const unlinkedA = acts.filter((a) => !a.user_id).length
const unlinkedR = refs.filter((r) => !r.submitted_by).length
if (unlinkedA) warn.push(`activities: ${unlinkedA} kept with the rep's name but no user account`)
if (unlinkedR) warn.push(`referrals: ${unlinkedR} kept with the rep's name but no user account`)
if (acts.length) await insert('daily_activities', acts, 'activities')
if (refs.length) await insert('referrals', refs, 'referrals')

// Needs analysis, replayed oldest first so the revision ledger reflects the
// real sequence of updates. The DB trigger writes one revision per save.
let naDone = 0
for (const [coKey, entries] of naByCompany) {
  const company_id = companyIdByName.get(coKey)
  if (!company_id) { warn.push(`needs analysis: no company for ${coKey}`); continue }
  let naId = null
  for (const e of entries) {
    const base = { company_id, analysis_type: e.analysisType, facility_id: facility.id,
      unit_type: e.unit_type, recommendation: e.recommendation,
      recommendation_reason: e.recommendation_reason }
    if (!naId) {
      const { data, error } = await db.from('needs_analysis').insert(base).select('id').single()
      if (error) { warn.push(`needs analysis ${coKey}: ${error.message}`); break }
      naId = data.id
    } else {
      await db.from('needs_analysis').update(base).eq('id', naId)
    }
    const shape = ['Eldercare', 'Hospital'].includes(e.analysisType) ? 'facility' : 'clinical'
    const detail = shape === 'facility' ? e.facilityDetail : e.clinicalDetail
    if (Object.values(detail).some((x) => x !== null && x !== undefined)) {
      await db.from(`needs_analysis_${shape}`)
        .upsert({ ...detail, needs_analysis_id: naId }, { onConflict: 'needs_analysis_id' })
    }
  }
  naDone++
  if (naDone % 25 === 0) process.stdout.write(`\r  needs analysis: ${naDone}/${naByCompany.size}`)
}
console.log(`\r  needs analysis: ${naDone}/${naByCompany.size}`)

console.log('\nDone.')
if (warn.length) { console.log('\nReview these:'); warn.forEach((w) => console.log('  - ' + w)) }
console.log('')
