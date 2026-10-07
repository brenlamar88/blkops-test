import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp, useQuery, fetchAll } from '../lib/data'
import { Banner, Empty, Loading, TerritoryChip, Check } from '../components/ui'
import { downloadCsv } from '../lib/csv'

/* ------------------------------------------------------------------
   Referral Scorecard — ranked referral sources for the SELECTED campus.

   Rebuild of the "TOP 20" referral pivot: each referring company with its
   city, category of referral and territory, and a count of referrals per
   month, ranked by total. Filter by admission status, territory, category,
   and how many to show. Scoped to facilityId — one campus at a time.
------------------------------------------------------------------ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const STATUSES = ['Admit', 'Pending', 'Denial']

export default function ReferralScorecard() {
  const { facilityId, facility, lookups } = useApp()
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [statuses, setStatuses] = useState({ Admit: true, Pending: false, Denial: false })
  const [terr, setTerr] = useState('')
  const [cat, setCat] = useState('')
  const [topN, setTopN] = useState('20')

  const catName = useMemo(() => {
    const m = {}; for (const c of lookups.categories ?? []) m[c.id] = c.name; return m
  }, [lookups.categories])
  const terrName = (id) => (lookups.territories ?? []).find((t) => t.id === id)?.name

  const q = useQuery(() => facilityId ? fetchAll(() => supabase.from('referrals')
    .select('prospect_company_id, referral_date, admission_status, category_id, territory_id, company:companies(id,name,city)')
    .eq('facility_id', facilityId)
    .gte('referral_date', `${year}-01-01`).lte('referral_date', `${year}-12-31`)
    .order('id')) : null, [facilityId, year])

  const rows = useMemo(() => q.rows.filter((r) => {
    if (!r.prospect_company_id || !r.company) return false
    if (!statuses[r.admission_status || 'Pending']) return false
    if (terr && r.territory_id !== terr) return false
    if (cat && r.category_id !== cat) return false
    return true
  }), [q.rows, statuses, terr, cat])

  const { scored, totals, grand } = useMemo(() => {
    const by = new Map()
    for (const r of rows) {
      const k = r.prospect_company_id
      let e = by.get(k)
      if (!e) { e = { id: k, name: r.company.name, city: r.company.city,
        months: Array(12).fill(0), total: 0, cats: {}, terrs: {} }; by.set(k, e) }
      const m = new Date(r.referral_date + 'T00:00:00').getMonth()
      e.months[m]++; e.total++
      const cn = catName[r.category_id]; if (cn) e.cats[cn] = (e.cats[cn] || 0) + 1
      const tn = terrName(r.territory_id); if (tn) e.terrs[tn] = (e.terrs[tn] || 0) + 1
    }
    const mode = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    let scored = [...by.values()]
      .map((e) => ({ ...e, category: mode(e.cats), territory: mode(e.terrs) }))
      .sort((a, b) => b.total - a.total || (a.name || '').localeCompare(b.name || ''))
    if (topN !== 'all') scored = scored.slice(0, Number(topN))
    const totals = Array(12).fill(0); let grand = 0
    for (const e of scored) { e.months.forEach((n, i) => { totals[i] += n }); grand += e.total }
    return { scored, totals, grand }
  }, [rows, catName, lookups.territories, topN])

  const num = (n) => n ? n : <span style={{ color: 'var(--rule)' }}>·</span>

  const exportCsv = () => {
    const columns = [
      { key: 'rank', label: '#' }, { key: 'name', label: 'Referral source' },
      { key: 'city', label: 'City' }, { key: 'category', label: 'Category' },
      { key: 'territory', label: 'Territory' },
      ...MONTHS.map((m, i) => ({ key: `m${i}`, label: m })),
      { key: 'total', label: 'Total' },
    ]
    const out = scored.map((e, i) => ({ rank: i + 1, name: e.name, city: e.city,
      category: e.category, territory: e.territory, total: e.total,
      ...Object.fromEntries(e.months.map((n, j) => [`m${j}`, n])) }))
    downloadCsv(`referral-scorecard-${facility?.slug ?? 'campus'}-${year}.csv`, columns, out)
  }

  const toggleStatus = (s) => setStatuses((x) => ({ ...x, [s]: !x[s] }))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Referral scorecard</h1>
          <p>{facility?.name ?? 'No campus'} — referral sources ranked by volume, by month.
             This campus only.</p>
        </div>
        <div className="row-actions">
          <button className="btn" type="button" onClick={() => window.print()}>Print</button>
          <button className="btn btn-primary" type="button" disabled={!scored.length}
                  onClick={exportCsv}>Download CSV</button>
        </div>
      </div>

      <div className="toolbar">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
          {[thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={terr} onChange={(e) => setTerr(e.target.value)} aria-label="Territory">
          <option value="">All territories</option>
          {(lookups.territories ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(lookups.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={topN} onChange={(e) => setTopN(e.target.value)} aria-label="Show">
          <option value="20">Top 20</option>
          <option value="50">Top 50</option>
          <option value="all">All sources</option>
        </select>
        <div className="seg" style={{ marginLeft: 4 }}>
          {STATUSES.map((s) => (
            <button key={s} type="button" className={statuses[s] ? 'on' : ''}
                    onClick={() => toggleStatus(s)}>{s}</button>
          ))}
        </div>
        <div className="spacer" />
        <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
          {q.loading ? '' : `${scored.length} sources · ${grand} referrals`}
        </span>
      </div>

      {q.error && <Banner kind="error">{q.error}</Banner>}

      {q.loading ? <Loading rows={10} /> : !scored.length ? (
        <Empty title="No referrals in this view"
               body="Widen the year or status filters, or log referrals for this campus." />
      ) : (
        <div className="card">
          <div className="matrix-scroll">
            <table className="pivot scorecard">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Referral source</th>
                  <th>City</th>
                  <th>Category</th>
                  <th>Territory</th>
                  {MONTHS.map((m) => <th key={m} className="num">{m}</th>)}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {scored.map((e, i) => (
                  <tr key={e.id}>
                    <td className="num" style={{ color: 'var(--ink-3)' }}>{i + 1}</td>
                    <td><Link to={`/companies/${e.id}`}>{e.name}</Link></td>
                    <td>{e.city ?? '—'}</td>
                    <td>{e.category ?? '—'}</td>
                    <td>{e.territory ? <TerritoryChip name={e.territory} /> : '—'}</td>
                    {e.months.map((n, j) => <td key={j} className="num">{num(n)}</td>)}
                    <td className="num tot">{e.total}</td>
                  </tr>
                ))}
                <tr className="pivot-total">
                  <td></td><td>Grand total</td><td></td><td></td><td></td>
                  {totals.map((n, j) => <td key={j} className="num">{num(n)}</td>)}
                  <td className="num tot">{grand}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
