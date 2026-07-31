import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp, useQuery } from '../lib/data'
import { Select, Banner, Loading, Empty, TerritoryChip } from '../components/ui'

/* ------------------------------------------------------------------
   Territory map — assign each city this campus works to one of its
   territories. This is the source of truth the activity and referral
   forms derive territory from (territory_for_city / fill_territory in
   the database). Scoped to the campus selected in the sidebar; a city
   can map to a different territory at a different campus.

   Writes are admin-only, mirrored by the tc_write RLS policy.
------------------------------------------------------------------ */

const norm = (s) => (s ?? '').trim().toLowerCase()

export default function TerritoryMap() {
  const { facilityId, facility, isAdmin, lookups } = useApp()
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null) // city key being written

  const territories = lookups.territories ?? []

  const mapQ = useQuery(() => facilityId
    ? supabase.from('territory_cities')
        .select('id, city, territory_id').eq('facility_id', facilityId)
    : null, [facilityId])

  // Every distinct company city in the org — the candidate list to assign.
  const cityQ = useQuery(() => supabase.from('companies')
    .select('city').eq('active', true).is('merged_into_id', null).limit(5000), [])

  // Union of company cities and already-mapped cities, one row per city,
  // carrying its current mapping (if any).
  const rows = useMemo(() => {
    const byKey = new Map()
    for (const c of cityQ.rows) {
      const k = norm(c.city)
      if (k && !byKey.has(k)) byKey.set(k, { key: k, city: c.city.trim(), map: null })
    }
    for (const m of mapQ.rows) {
      const k = norm(m.city)
      const row = byKey.get(k) ?? { key: k, city: m.city.trim(), map: null }
      row.map = m
      byKey.set(k, row)
    }
    return [...byKey.values()].sort((a, b) => a.city.localeCompare(b.city))
  }, [cityQ.rows, mapQ.rows])

  const assign = async (row, territoryId) => {
    setError(null); setBusy(row.key)
    try {
      if (territoryId) {
        if (row.map) {
          const { error } = await supabase.from('territory_cities')
            .update({ territory_id: territoryId }).eq('id', row.map.id)
          if (error) throw error
        } else {
          const { error } = await supabase.from('territory_cities')
            .insert({ facility_id: facilityId, city: row.city, territory_id: territoryId })
          if (error) throw error
        }
      } else if (row.map) {
        const { error } = await supabase.from('territory_cities').delete().eq('id', row.map.id)
        if (error) throw error
      }
      mapQ.refresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const terrName = (id) => territories.find((t) => t.id === id)?.name
  const mapped = rows.filter((r) => r.map).length

  if (mapQ.loading || cityQ.loading) return <Loading rows={8} />

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Territory map</h1>
          <p>{facility?.name ?? 'No campus'} — assign each city to a territory. The
            activity and referral forms fill territory in from the company's city.
            A city can map differently at another campus.</p>
        </div>
        <div className="kpi" style={{ minWidth: 130 }}>
          <span className="l">Cities mapped</span>
          <span className="n">{mapped}/{rows.length}</span>
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {!isAdmin && (
        <Banner kind="info">You need the admin role at this campus to change the map.
          These assignments are read-only for you.</Banner>
      )}

      <div className="card">
        {rows.length === 0 ? (
          <Empty title="No cities yet"
                 body="Cities come from your companies. Import or add companies first." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>City</th>
                  <th>Territory</th>
                  <th style={{ width: 220 }}>Assign</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className={`rail ${r.map ? '' : ''}`}>{r.city}</td>
                    <td>{r.map ? <TerritoryChip name={terrName(r.map.territory_id)} />
                              : <span style={{ color: 'var(--ink-3)' }}>— unmapped —</span>}</td>
                    <td>
                      <Select value={r.map?.territory_id ?? ''}
                              onChange={(val) => assign(r, val)}
                              disabled={!isAdmin || busy === r.key}
                              placeholder="— none —"
                              options={territories.map((t) => [t.id, t.name])} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
