import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp, useQuery, fetchAll } from '../lib/data'
import { Banner, Empty, Loading, TerritoryChip, Chip } from '../components/ui'
import { fmtDate } from '../lib/format'
import { downloadCsv } from '../lib/csv'

/* ------------------------------------------------------------------
   MIS — referral sources that have gone cold.

   Pulls the whole referral log for the SELECTED campus and lists every
   company that has NOT had a referral reach "Admit" within the lookback
   window (90 days by default). A company that has referred but never
   admitted shows too — its last admit is simply "Never". Sorted by how
   long it has been cold, longest first, so the worklist starts with the
   accounts most overdue for a visit. Scoped to facilityId — one campus.
------------------------------------------------------------------ */

const WINDOWS = [
  ['30', '30 days'], ['60', '60 days'], ['90', '90 days'],
  ['120', '120 days'], ['180', '180 days'],
]
const DAY = 86400000

export default function Mis() {
  const { facilityId, facility, lookups } = useApp()
  const [days, setDays] = useState('90')
  const [terr, setTerr] = useState('')
  const [cat, setCat] = useState('')

  const catName = useMemo(() => {
    const m = {}; for (const c of lookups.categories ?? []) m[c.id] = c.name; return m
  }, [lookups.categories])
  const terrName = (id) => (lookups.territories ?? []).find((t) => t.id === id)?.name

  // Whole referral log for this campus — no date bound, so we can find the
  // most recent admit per company however far back it was.
  const q = useQuery(() => facilityId ? fetchAll(() => supabase.from('referrals')
    .select('prospect_company_id, referral_date, admission_status, category_id, territory_id, company:companies(id,name,city)')
    .eq('facility_id', facilityId)
    .order('id')) : null, [facilityId])

  const { cold, cutoffISO } = useMemo(() => {
    const cutoff = new Date(Date.now() - Number(days) * DAY)
    const cutoffISO = cutoff.toISOString().slice(0, 10)

    const by = new Map()
    for (const r of q.rows) {
      if (!r.prospect_company_id || !r.company) continue
      const k = r.prospect_company_id
      let e = by.get(k)
      if (!e) { e = { id: k, name: r.company.name, city: r.company.city,
        total: 0, admits: 0, lastRef: null, lastAdmit: null, cats: {}, terrs: {} }; by.set(k, e) }
      e.total++
      if (r.referral_date && r.referral_date > (e.lastRef ?? '')) e.lastRef = r.referral_date
      if (r.admission_status === 'Admit') {
        e.admits++
        if (r.referral_date && r.referral_date > (e.lastAdmit ?? '')) e.lastAdmit = r.referral_date
      }
      const cn = catName[r.category_id]; if (cn) e.cats[cn] = (e.cats[cn] || 0) + 1
      const tn = terrName(r.territory_id); if (tn) e.terrs[tn] = (e.terrs[tn] || 0) + 1
    }

    const mode = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const today = new Date().toISOString().slice(0, 10)
    const daysSince = (d) => d ? Math.round((new Date(today) - new Date(d)) / DAY) : null

    let cold = [...by.values()]
      // Cold = no admit at all, or the last admit is older than the cutoff.
      .filter((e) => !e.lastAdmit || e.lastAdmit < cutoffISO)
      .map((e) => ({ ...e, category: mode(e.cats), territory: mode(e.terrs),
        sinceAdmit: daysSince(e.lastAdmit), sinceRef: daysSince(e.lastRef) }))
      // Filters
      .filter((e) => (!terr || e.terrs[terrName(terr)]) && (!cat || e.cats[catName[cat]]))
      // Longest cold first: never-admitted (null) on top, then oldest admit.
      .sort((a, b) => {
        if (a.lastAdmit === b.lastAdmit) return (b.sinceRef ?? 0) - (a.sinceRef ?? 0)
        if (!a.lastAdmit) return -1
        if (!b.lastAdmit) return 1
        return a.lastAdmit < b.lastAdmit ? -1 : 1
      })
    return { cold, cutoffISO }
  }, [q.rows, days, terr, cat, catName, lookups.territories])

  const exportCsv = () => {
    const columns = [
      { key: 'name', label: 'Company' }, { key: 'city', label: 'City' },
      { key: 'category', label: 'Category' }, { key: 'territory', label: 'Territory' },
      { key: 'lastAdmit', label: 'Last admit' }, { key: 'sinceAdmit', label: 'Days since admit' },
      { key: 'lastRef', label: 'Last referral' }, { key: 'admits', label: 'Total admits' },
      { key: 'total', label: 'Total referrals' },
    ]
    const out = cold.map((e) => ({ name: e.name, city: e.city, category: e.category,
      territory: e.territory, lastAdmit: e.lastAdmit ?? 'Never',
      sinceAdmit: e.sinceAdmit ?? '', lastRef: e.lastRef ?? '', admits: e.admits, total: e.total }))
    downloadCsv(`mis-${facility?.slug ?? 'campus'}-${days}d.csv`, columns, out)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>MIS</h1>
          <p>{facility?.name ?? 'No campus'} — referral sources with no admit in the past
             {' '}{days} days. Worklist for re-engagement; longest cold first. This campus only.</p>
        </div>
        <div className="row-actions">
          <button className="btn" type="button" onClick={() => window.print()}>Print</button>
          <button className="btn btn-primary" type="button" disabled={!cold.length}
                  onClick={exportCsv}>Download CSV</button>
        </div>
      </div>

      <div className="toolbar">
        <select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Window">
          {WINDOWS.map(([v, l]) => <option key={v} value={v}>No admit in {l}</option>)}
        </select>
        <select value={terr} onChange={(e) => setTerr(e.target.value)} aria-label="Territory">
          <option value="">All territories</option>
          {(lookups.territories ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(lookups.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="spacer" />
        <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
          {q.loading ? '' : `${cold.length} cold ${cold.length === 1 ? 'source' : 'sources'} · since ${fmtDate(cutoffISO)}`}
        </span>
      </div>

      {q.error && <Banner kind="error">{q.error}</Banner>}

      {q.loading ? <Loading rows={10} /> : !cold.length ? (
        <Empty title="No cold sources in this view"
               body="Every referral source here has had an admit inside the window — or there are no referrals logged for this campus yet." />
      ) : (
        <div className="card">
          <div className="matrix-scroll">
            <table className="pivot scorecard">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Company</th>
                  <th>City</th>
                  <th>Category</th>
                  <th>Territory</th>
                  <th>Last admit</th>
                  <th className="num">Days cold</th>
                  <th>Last referral</th>
                  <th className="num">Admits</th>
                  <th className="num">Referrals</th>
                </tr>
              </thead>
              <tbody>
                {cold.map((e, i) => (
                  <tr key={e.id}>
                    <td className="num" style={{ color: 'var(--ink-3)' }}>{i + 1}</td>
                    <td><Link to={`/companies/${e.id}`}>{e.name}</Link></td>
                    <td>{e.city ?? '—'}</td>
                    <td>{e.category ?? '—'}</td>
                    <td>{e.territory ? <TerritoryChip name={e.territory} /> : '—'}</td>
                    <td>{e.lastAdmit ? fmtDate(e.lastAdmit) : <Chip kind="bad">Never</Chip>}</td>
                    <td className="num">{e.sinceAdmit ?? '—'}</td>
                    <td>{e.lastRef ? fmtDate(e.lastRef) : '—'}</td>
                    <td className="num">{e.admits || <span style={{ color: 'var(--rule)' }}>·</span>}</td>
                    <td className="num tot">{e.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
