import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp, useQuery, fetchAll, today, daysAgo } from '../lib/data'
import { Banner } from '../components/ui'
import { UNIT_TYPES } from '../lib/enums'
import { DonutBlock, MiniPanel, BreakdownPanel, NoData, colorMap } from '../components/charts'

/* ------------------------------------------------------------------
   Activity dashboard — a like-for-like rebuild of the old Gravity Forms
   "ACTIVITIES" analytics screen, over daily_activities (form 113) and
   referrals (form 135).

   Filtering follows the app convention: the server query is scoped to the
   campus and date range, and the cheaper dimension filters (unit type, rep,
   referral category) run client-side over the loaded page so they can
   cross-filter and drive their own dropdowns.
------------------------------------------------------------------ */

// Enum value → the label the old dashboard showed. Order matches the old
// screen; Luncheon is a real form-113 type the screenshot omitted.
const ACTIVITY_CARDS = [
  ['Quality Touch', 'Quality Touches'],
  ['Face to Face', 'Face to Face'],
  ['Cold Call', 'Cold Call'],
  ['Leave Behind', 'Leave Behind'],
  ['HWD Survey', 'HWD Survey'],
  ['Follow-Up', 'Follow Up'],
  ['In-Service', 'In-Service'],
  ['Luncheon', 'Luncheon'],
  ['Pre Screen', 'Pre Screen'],
  ["Thank You's", "Thank You's"],
]

const repOf = (person, fallback) => {
  const n = person ? [person.first_name, person.last_name].filter(Boolean).join(' ') : ''
  return n || fallback || 'Unknown'
}

const Stat = ({ label, value, big }) => (
  <div className={`stat ${big ? 'stat-lg' : ''}`}>
    <span className="l">{label}</span>
    <span className="n">{value}</span>
  </div>
)

// group rows → [{ label, value, color }] with stable colours
function groupCounts(rows, keyFn, colors) {
  const counts = {}
  for (const r of rows) {
    const k = keyFn(r) || 'Uncategorized'
    counts[k] = (counts[k] ?? 0) + 1
  }
  return Object.entries(counts).map(([label, value]) => ({ label, value, color: colors[label] }))
}

export default function ActivityDashboard() {
  const { facilityId, facility, lookups } = useApp()
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [unit, setUnit] = useState('')
  const [rep, setRep] = useState('')
  const [refCat, setRefCat] = useState('')
  const [refBy, setRefBy] = useState('')

  const catName = useMemo(() => {
    const m = {}; for (const c of lookups.categories ?? []) m[c.id] = c.name; return m
  }, [lookups.categories])
  const terrName = useMemo(() => {
    const m = {}; for (const t of lookups.territories ?? []) m[t.id] = t.name; return m
  }, [lookups.territories])

  const actsQ = useQuery(() => facilityId ? fetchAll(() => supabase.from('daily_activities')
    .select(`id, activity_type, unit_type, user_id, source_rep_name,
             company:companies(name, category_id),
             user:profiles(first_name,last_name)`)
    .eq('facility_id', facilityId)
    .gte('activity_date', from).lte('activity_date', to)
    .order('id')) : null, [facilityId, from, to])

  const refsQ = useQuery(() => facilityId ? fetchAll(() => supabase.from('referrals')
    .select(`id, admission_status, category_id, territory_id,
             submitted_by, source_rep_name, submitter:profiles(first_name,last_name)`)
    .eq('facility_id', facilityId)
    .gte('referral_date', from).lte('referral_date', to)
    .order('id')) : null, [facilityId, from, to])

  const naQ = useQuery(() => facilityId ? fetchAll(() => supabase.from('needs_analysis_full')
    .select('id, analysis_type, category_id, territory_id')
    .eq('facility_id', facilityId).order('id')) : null, [facilityId])

  // ---- activities: derive dropdowns, then apply client-side filters ----
  const allActs = actsQ.rows
  const repLabel = (r) => repOf(r.user, r.source_rep_name)
  const repOptions = useMemo(
    () => [...new Set(allActs.map(repLabel))].sort(), [allActs])

  const acts = allActs.filter((r) =>
    (!unit || r.unit_type === unit) && (!rep || repLabel(r) === rep))

  const repColors = useMemo(() => colorMap(acts.map(repLabel)), [acts])
  const catColors = useMemo(
    () => colorMap((lookups.categories ?? []).map((c) => c.name).concat('Uncategorized')),
    [lookups.categories])

  const byRep = groupCounts(acts, repLabel, repColors)
  const byCategory = groupCounts(acts, (r) => catName[r.company?.category_id], catColors)
  const actTypeCount = (t) => acts.filter((r) => r.activity_type === t).length

  // ---- referrals ----
  const allRefs = refsQ.rows
  const refByLabel = (r) => repOf(r.submitter, r.source_rep_name)
  const refByOptions = useMemo(() => [...new Set(allRefs.map(refByLabel))].sort(), [allRefs])
  const refCatOptions = useMemo(
    () => [...new Set(allRefs.map((r) => catName[r.category_id]).filter(Boolean))].sort(),
    [allRefs, catName])

  const refs = allRefs.filter((r) =>
    (!refCat || catName[r.category_id] === refCat) && (!refBy || refByLabel(r) === refBy))
  const admits = refs.filter((r) => r.admission_status === 'Admit')
  const denials = refs.filter((r) => r.admission_status === 'Denial')
  const admitsByCat = groupCounts(admits, (r) => catName[r.category_id], catColors)
  const admitsByTerr = groupCounts(admits, (r) => terrName[r.territory_id], {})

  // ---- needs analysis (empty until loaded) ----
  const na = naQ.rows
  const naByCat = groupCounts(na, (r) => catName[r.category_id], {})
  const naByTerr = groupCounts(na, (r) => terrName[r.territory_id], {})
  const naByType = groupCounts(na, (r) => r.analysis_type, {})

  const loading = actsQ.loading || refsQ.loading
  const err = actsQ.error || refsQ.error

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Activities</h1>
          <p>{facility?.name ?? 'No campus'} — activity and referral summary,
            rebuilt from the Gravity Forms dashboard.</p>
        </div>
        <div className="row-actions">
          <button className="btn btn-primary" type="button" onClick={() => window.print()}>
            Download PDF
          </button>
        </div>
      </div>

      <div className="toolbar">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <span style={{ color: 'var(--ink-3)' }}>to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit type">
          <option value="">All unit types</option>
          {UNIT_TYPES.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={rep} onChange={(e) => setRep(e.target.value)} aria-label="Entry username">
          <option value="">All entry usernames</option>
          {repOptions.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <div className="spacer" />
        <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
          {loading ? '' : `${acts.length} activities · ${refs.length} referrals`}
        </span>
      </div>

      {err && <Banner kind="error">{err}</Banner>}

      <div className="dash-grid">
        {/* ---- column 1: activity mix ---- */}
        <div className="dash-col">
          <DonutBlock title="By entry username" keyLabel="Entry Username" rows={byRep} />
          <DonutBlock title="By company category" keyLabel="Company Category" rows={byCategory} />
        </div>

        {/* ---- column 2: activity counts ---- */}
        <div className="dash-col">
          <div className="stat-stack">
            <Stat label="Total Activities" value={acts.length} big />
            {ACTIVITY_CARDS.map(([type, label]) => (
              <Stat key={type} label={label} value={actTypeCount(type)} />
            ))}
          </div>
          <BreakdownPanel title="Needs Analysis by Category" keyLabel="Category" rows={naByCat} />
        </div>

        {/* ---- column 3: referrals & outcomes ---- */}
        <div className="dash-col">
          <div className="ref-filters">
            <select value={refCat} onChange={(e) => setRefCat(e.target.value)} aria-label="Category of referral">
              <option value="">Category of referral</option>
              {refCatOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={refBy} onChange={(e) => setRefBy(e.target.value)} aria-label="Referral submitted by">
              <option value="">Referral submitted by</option>
              {refByOptions.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="stat-stack">
            <Stat label="Referrals" value={refs.length} big />
            <Stat label="Admits" value={admits.length} />
            <Stat label="Denials" value={denials.length} />
          </div>
          <div className="panel-pair">
            <BreakdownPanel title="Admits by Category" keyLabel="Category" rows={admitsByCat} />
            <BreakdownPanel title="Admits by Territory" keyLabel="Territory" rows={admitsByTerr} />
          </div>
          <div className="panel-pair">
            <BreakdownPanel title="Needs Analysis by Territory" keyLabel="Territory" rows={naByTerr} />
            <BreakdownPanel title="Needs Analysis by Type" keyLabel="Type" rows={naByType} />
          </div>
        </div>
      </div>
    </>
  )
}
