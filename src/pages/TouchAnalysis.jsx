import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp, useQuery, fetchAll, today, daysAgo } from '../lib/data'
import { Banner, Empty, Loading, Chip } from '../components/ui'
import { downloadCsv } from '../lib/csv'
import { ACTIVITY_TYPES, UNIT_TYPES } from '../lib/enums'

/* ------------------------------------------------------------------
   Touch Analysis — a rebuild of the CEO touch-analysis workbook.

   A pivot of "touches" (sum of Number of Activities) by Activity Type (rows)
   × Company Category (columns), grouped into week or month periods, optionally
   scoped to one territory or unit type, each period graded against a weekly
   touch goal (default 60/week per the workbook's grading scale).
------------------------------------------------------------------ */

// Percent-of-goal → letter, matching the workbook's scale
// (100–93 A, 92–85 B, 84–77 C, 76–70 D, 69– F).
const gradeLetter = (pct) =>
  pct >= 0.93 ? 'A' : pct >= 0.85 ? 'B' : pct >= 0.77 ? 'C' : pct >= 0.70 ? 'D' : 'F'
const gradeKind = (letter) =>
  letter === 'A' || letter === 'B' ? 'ok' : letter === 'F' ? 'bad' : ''

const iso = (d) => d.toISOString().slice(0, 10)
// Sunday-start week containing dateStr.
const weekStart = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() - d.getDay())
  return iso(d)
}
const monthStart = (dateStr) => dateStr.slice(0, 7) + '-01'
const weeksInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  const first = new Date(y, m - 1, 1), last = new Date(y, m, 0)
  return Math.ceil((first.getDay() + last.getDate()) / 7)
}
const fmtWeek = (isoDate) => 'Week of ' +
  new Date(isoDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
const fmtMonth = (isoDate) =>
  new Date(isoDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

function Matrix({ title, badge, cats, pivot }) {
  // pivot: { rows: {type: {cat: n}}, rowTotal: {type}, colTotal: {cat}, total }
  const types = ACTIVITY_TYPES.filter((t) => pivot.rowTotal[t])
  const cell = (n) => (n ? n : <span style={{ color: 'var(--rule)' }}>·</span>)
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <h2>{title}</h2>
        {badge}
      </div>
      <div className="table-wrap">
        <table className="pivot">
          <thead>
            <tr>
              <th>Activity type</th>
              {cats.map((c) => <th key={c} className="num">{c}</th>)}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t}>
                <td>{t}</td>
                {cats.map((c) => <td key={c} className="num">{cell(pivot.rows[t]?.[c])}</td>)}
                <td className="num tot">{pivot.rowTotal[t]}</td>
              </tr>
            ))}
            <tr className="pivot-total">
              <td>Grand total</td>
              {cats.map((c) => <td key={c} className="num">{cell(pivot.colTotal[c])}</td>)}
              <td className="num tot">{pivot.total}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function TouchAnalysis() {
  const { facilityId, facility, lookups } = useApp()
  const [gran, setGran] = useState('week')
  const [from, setFrom] = useState(daysAgo(56))
  const [to, setTo] = useState(today())
  const [terr, setTerr] = useState('')
  const [unit, setUnit] = useState('')
  const [goal, setGoal] = useState(60)

  const cats = useMemo(() => (lookups.categories ?? [])
    .slice().sort((a, b) => a.sort_order - b.sort_order).map((c) => c.name), [lookups.categories])
  const catName = useMemo(() => {
    const m = {}; for (const c of lookups.categories ?? []) m[c.id] = c.name; return m
  }, [lookups.categories])
  const terrName = (id) => (lookups.territories ?? []).find((t) => t.id === id)?.name

  const q = useQuery(() => facilityId ? fetchAll(() => supabase.from('daily_activities')
    .select('activity_type, number_of_activities, activity_date, territory_id, unit_type, company:companies(category_id)')
    .eq('facility_id', facilityId).gte('activity_date', from).lte('activity_date', to)
    .order('id')) : null, [facilityId, from, to])

  const rows = useMemo(() => q.rows.filter((r) =>
    (!terr || r.territory_id === terr) && (!unit || r.unit_type === unit) && r.activity_type),
    [q.rows, terr, unit])

  // Build a blank pivot and a folder that adds touches to it.
  const blank = () => ({ rows: {}, rowTotal: {}, colTotal: {}, total: 0 })
  const add = (p, type, cat, n) => {
    const c = cats.includes(cat) ? cat : 'Uncategorized'
    p.rows[type] = p.rows[type] || {}
    p.rows[type][c] = (p.rows[type][c] || 0) + n
    p.rowTotal[type] = (p.rowTotal[type] || 0) + n
    p.colTotal[c] = (p.colTotal[c] || 0) + n
    p.total += n
  }

  const { periods, overall, cols } = useMemo(() => {
    const byPeriod = new Map()
    const all = blank()
    let hasUncat = false
    for (const r of rows) {
      const n = r.number_of_activities ?? 1
      const cat = catName[r.company?.category_id]
      if (!cats.includes(cat)) hasUncat = true
      const key = gran === 'week' ? weekStart(r.activity_date) : monthStart(r.activity_date)
      if (!byPeriod.has(key)) byPeriod.set(key, blank())
      add(byPeriod.get(key), r.activity_type, cat, n)
      add(all, r.activity_type, cat, n)
    }
    const cols = hasUncat ? [...cats, 'Uncategorized'] : cats
    const periods = [...byPeriod.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, pivot]) => {
        const periodGoal = gran === 'week' ? goal : goal * weeksInMonth(key.slice(0, 7))
        const pct = periodGoal ? pivot.total / periodGoal : 0
        return { key, pivot, label: gran === 'week' ? fmtWeek(key) : fmtMonth(key),
                 periodGoal, pct, letter: gradeLetter(pct) }
      })
    const overGoal = goal * periods.length
    return { periods, cols,
      overall: { pivot: all, periodGoal: overGoal, pct: overGoal ? all.total / overGoal : 0,
                 letter: gradeLetter(overGoal ? all.total / overGoal : 0) } }
  }, [rows, cats, catName, gran, goal])

  const scopeLabel = (terr && terrName(terr) ? `${terrName(terr)} · ` : '') + (unit ? `${unit} · ` : '')

  const exportCsv = () => {
    const out = []
    for (const p of periods) {
      for (const t of ACTIVITY_TYPES) {
        if (!p.pivot.rowTotal[t]) continue
        const row = { period: p.label, activity: t, total: p.pivot.rowTotal[t] }
        for (const c of cols) row[c] = p.pivot.rows[t]?.[c] ?? 0
        out.push(row)
      }
    }
    const columns = [{ key: 'period', label: gran === 'week' ? 'Week' : 'Month' },
      { key: 'activity', label: 'Activity type' },
      ...cols.map((c) => ({ key: c, label: c })),
      { key: 'total', label: 'Total' }]
    downloadCsv(`touch-analysis-${from}-to-${to}.csv`, columns, out)
  }

  const GradeBadge = ({ letter, total, goalVal }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
        {total} / {goalVal} touches
      </span>
      <Chip kind={gradeKind(letter)}>Grade {letter}</Chip>
    </div>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Touch analysis</h1>
          <p>{facility?.name ?? 'No campus'} — touches by activity type and company
             category, graded against a {goal}/week goal. Weeks start Sunday.</p>
        </div>
        <div className="row-actions">
          <button className="btn" type="button" onClick={() => window.print()}>Print</button>
          <button className="btn btn-primary" type="button" disabled={!periods.length}
                  onClick={exportCsv}>Download CSV</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg">
          <button type="button" className={gran === 'week' ? 'on' : ''} onClick={() => setGran('week')}>Week</button>
          <button type="button" className={gran === 'month' ? 'on' : ''} onClick={() => setGran('month')}>Month</button>
        </div>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <span style={{ color: 'var(--ink-3)' }}>to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select value={terr} onChange={(e) => setTerr(e.target.value)} aria-label="Territory">
          <option value="">All territories</option>
          {(lookups.territories ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit type">
          <option value="">All unit types</option>
          {UNIT_TYPES.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)' }}>
          Goal/wk
          <input type="number" min="1" value={goal} style={{ width: 70 }}
                 onChange={(e) => setGoal(Number(e.target.value) || 0)} />
        </label>
        <div className="spacer" />
        <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
          {q.loading ? '' : `${rows.length} activities`}
        </span>
      </div>

      {q.error && <Banner kind="error">{q.error}</Banner>}
      <Banner kind="info">
        Validated in-service or prescreen adds points; a devalidated one subtracts —
        applied in the field, not computed here. Touch goal is {goal}/week per territory.
      </Banner>

      {q.loading ? <Loading rows={8} /> : !periods.length ? (
        <Empty title="No activity in this range" body="Widen the dates or clear the filters." />
      ) : (
        <>
          <Matrix
            title={`${scopeLabel}Total for range`}
            badge={<GradeBadge letter={overall.letter} total={overall.pivot.total} goalVal={overall.periodGoal} />}
            cats={cols} pivot={overall.pivot} />
          {periods.map((p) => (
            <Matrix key={p.key} title={`${scopeLabel}${p.label}`}
              badge={<GradeBadge letter={p.letter} total={p.pivot.total} goalVal={p.periodGoal} />}
              cats={cols} pivot={p.pivot} />
          ))}
        </>
      )}
    </>
  )
}
