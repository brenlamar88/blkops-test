import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp, useQuery, fetchAll } from '../lib/data'
import { Banner, Empty, Loading, TerritoryChip } from '../components/ui'

/* ------------------------------------------------------------------
   Companies by territory — the account book for the SELECTED campus only.

   Territory is read from facility_companies (the company's assignment at
   THIS campus), so a company shared with another campus can sit in a
   different territory there. Scoped to the current facilityId; it never
   mixes campuses.
------------------------------------------------------------------ */

export default function CompanyTerritories() {
  const { facilityId, facility, lookups } = useApp()
  const [search, setSearch] = useState('')

  const terrOrder = useMemo(() => (lookups.territories ?? [])
    .slice().sort((a, b) => a.sort_order - b.sort_order), [lookups.territories])
  const terrName = (id) => (lookups.territories ?? []).find((t) => t.id === id)?.name

  const q = useQuery(() => facilityId ? fetchAll(() => supabase.from('facility_companies')
    .select('territory_id, company:companies(id, name, city, active, merged_into_id)')
    .eq('facility_id', facilityId).order('company_id')) : null, [facilityId])

  const rows = useMemo(() => q.rows
    .filter((r) => r.company && r.company.active && !r.company.merged_into_id)
    .map((r) => ({ id: r.company.id, name: r.company.name, city: r.company.city,
                   terr: terrName(r.territory_id) })), [q.rows, lookups.territories])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => (r.name || '').toLowerCase().includes(s)
      || (r.city || '').toLowerCase().includes(s))
  }, [rows, search])

  // Group into territory buckets in Red/White/Blue/Gold order, Unassigned last.
  const groups = useMemo(() => {
    const by = new Map()
    for (const r of filtered) {
      const key = r.terr || 'Unassigned'
      if (!by.has(key)) by.set(key, [])
      by.get(key).push(r)
    }
    const ordered = []
    for (const t of terrOrder) if (by.has(t.name)) ordered.push([t.name, by.get(t.name)])
    // any territory names not in the lookup, then Unassigned
    for (const [k, v] of by) if (k !== 'Unassigned' && !terrOrder.some((t) => t.name === k)) ordered.push([k, v])
    if (by.has('Unassigned')) ordered.push(['Unassigned', by.get('Unassigned')])
    for (const g of ordered) g[1].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    return ordered
  }, [filtered, terrOrder])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Territories</h1>
          <p>{facility?.name ?? 'No campus'} — its accounts grouped by territory. This is
             {' '}this campus only; a shared company can be in a different territory elsewhere.</p>
        </div>
      </div>

      <div className="toolbar">
        <input placeholder="Search company or city…" value={search}
               onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 230 }} />
        <div className="spacer" />
        <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
          {q.loading ? '' : `${rows.length} companies`}
        </span>
      </div>

      {q.error && <Banner kind="error">{q.error}</Banner>}
      {!q.loading && rows.length > 0 && groups.length === 1 && groups[0][0] === 'Unassigned' && (
        <Banner kind="info">
          No territories are assigned to this campus's companies yet. Load them from your
          territory spreadsheet and they'll group here automatically.
        </Banner>
      )}

      {q.loading ? <Loading rows={8} /> : rows.length === 0 ? (
        <Empty title="No companies for this campus"
               body="Link or import companies for this campus first." />
      ) : groups.map(([name, list]) => (
        <div className="card" key={name} style={{ marginBottom: 14 }}>
          <div className="card-head">
            <h2>{name === 'Unassigned'
              ? <span style={{ color: 'var(--ink-3)' }}>Unassigned</span>
              : <TerritoryChip name={name} />}</h2>
            <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>{list.length}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Company</th><th>City</th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className={name === 'Unassigned' ? '' : undefined}>
                    <td data-label="Company"><Link to={`/companies/${r.id}`}>{r.name}</Link></td>
                    <td data-label="City">{r.city ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  )
}
