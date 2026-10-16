import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp, useQuery, fetchAll } from '../lib/data'
import { Banner, Empty, Loading, Chip } from '../components/ui'

/* ------------------------------------------------------------------
   City check — find and fix misspelled / inconsistent city names.

   City lives on the shared companies row and drives territory (via the
   per-facility city map), so a typo both fragments the data and can break
   territory resolution. This screen groups look-alike spellings into
   clusters, lets an admin pick the correct one and fold the rest into it,
   and flags values that don't look like a city. Merging calls the
   merge_city() function, which renames the shared rows, re-derives the
   affected territories, and cleans up orphaned map rows — org-wide, so it
   affects every campus that works those accounts.
------------------------------------------------------------------ */

const norm = (s) => (s ?? '').trim().toUpperCase()

// Levenshtein distance, capped small — we only care about near-identical.
function editDistance(a, b) {
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 3) return 99
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let cur = new Array(n + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    [prev, cur] = [cur, prev]
  }
  return prev[n]
}

// Two cities are "look-alike" if a small number of edits apart.
const alike = (a, b) => {
  if (a === b) return false
  const d = editDistance(a, b)
  const maxlen = Math.max(a.length, b.length)
  return maxlen >= 5 ? d <= 2 : d <= 1
}

// Values that probably aren't a city at all.
const NOT_A_CITY = /\b(PARISH|COUNTY|RESIDENT|FAMILY|UNKNOWN|UNKOWN|N\/?A)\b|^TX$|^LA$/

export default function CityCheck() {
  const { isAdmin } = useApp()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [search, setSearch] = useState('')

  const q = useQuery(() => fetchAll(() => supabase.from('companies')
    .select('city').is('merged_into_id', null)), [])

  // Distinct cities with counts.
  const cities = useMemo(() => {
    const m = new Map()
    for (const r of q.rows) {
      const c = norm(r.city)
      if (!c) continue
      m.set(c, (m.get(c) || 0) + 1)
    }
    return [...m.entries()].map(([city, n]) => ({ city, n })).sort((a, b) => a.city.localeCompare(b.city))
  }, [q.rows])

  // Cluster look-alike spellings (union-find over the alike() relation).
  const clusters = useMemo(() => {
    const items = cities.filter((c) => c.city.length >= 3)
    const parent = items.map((_, i) => i)
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++)
        if (alike(items[i].city, items[j].city)) parent[find(i)] = find(j)
    const groups = new Map()
    items.forEach((it, i) => {
      const root = find(i)
      if (!groups.has(root)) groups.set(root, [])
      groups.get(root).push(it)
    })
    return [...groups.values()]
      .filter((g) => g.length > 1)
      .map((g) => g.sort((a, b) => b.n - a.n))
      .sort((a, b) => b.reduce((s, x) => s + x.n, 0) - a.reduce((s, x) => s + x.n, 0))
  }, [cities])

  const flagged = useMemo(
    () => cities.filter((c) => NOT_A_CITY.test(c.city)), [cities])

  const filtered = useMemo(() => {
    const s = norm(search)
    return s ? cities.filter((c) => c.city.includes(s)) : cities
  }, [cities, search])

  // Merge one or more source cities into a target, in sequence.
  const mergeInto = async (froms, to) => {
    setBusy(`->${norm(to)}`); setError(null); setNote(null)
    let total = 0
    try {
      for (const from of froms) {
        if (norm(from) === norm(to)) continue
        const { data, error } = await supabase.rpc('merge_city', { p_old: from, p_new: to })
        if (error) throw error
        total += data ?? 0
      }
      setNote(`Merged into ${norm(to)} — ${total} ${total === 1 ? 'company' : 'companies'} updated.`)
      await q.refresh()
    } catch (e) { setError(e.message) }
    setBusy(null)
  }

  const renamePrompt = (city) => {
    const to = window.prompt(`Rename "${city}" to:`, city)
    if (to && norm(to) !== city) mergeInto([city], to.trim())
  }

  if (!isAdmin) {
    return (
      <>
        <div className="page-head"><div><h1>City check</h1></div></div>
        <Empty title="Admins only" body="You need the admin role to merge city names." />
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>City check</h1>
          <p>Find misspelled or inconsistent city names and fold them together.
             City drives territory, so fixing a spelling here repairs territory too.
             Changes apply to the shared accounts across every campus.</p>
        </div>
        <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
          {q.loading ? '' : `${cities.length} distinct cities`}
        </span>
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {note && <Banner kind="ok">{note}</Banner>}

      {q.loading ? <Loading rows={8} /> : (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <h2>Look-alike spellings</h2>
              <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                {clusters.length} {clusters.length === 1 ? 'cluster' : 'clusters'}
              </span>
            </div>
            <div className="card-body">
              {!clusters.length ? (
                <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 13 }}>
                  No near-duplicate city spellings found.
                </p>
              ) : (
                <div className="dupe-list">
                  {clusters.map((g, i) => (
                    <Cluster key={i} group={g} busy={busy} onMerge={mergeInto} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {flagged.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-head"><h2>Doesn’t look like a city</h2></div>
              <div className="card-body">
                <div className="dupe-list">
                  {flagged.map((c) => (
                    <div className="dupe" key={c.city}>
                      <div className="dupe-main">
                        <span className="dupe-name">{c.city}</span>
                        <span className="dupe-sub">{c.n} {c.n === 1 ? 'company' : 'companies'}</span>
                      </div>
                      <button className="btn btn-sm" type="button" disabled={!!busy}
                              onClick={() => renamePrompt(c.city)}>Rename…</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head"><h2>All cities</h2></div>
            <div className="card-body">
              <div className="toolbar" style={{ marginTop: 0 }}>
                <input type="search" placeholder="Search cities…" value={search}
                       onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 220 }} />
              </div>
              <div className="dupe-list">
                {filtered.map((c) => (
                  <div className="dupe" key={c.city}>
                    <div className="dupe-main">
                      <span className="dupe-name">{c.city}</span>
                      <span className="dupe-sub">{c.n} {c.n === 1 ? 'company' : 'companies'}</span>
                    </div>
                    <button className="btn btn-sm" type="button" disabled={!!busy}
                            onClick={() => renamePrompt(c.city)}>Rename…</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}

// One cluster of look-alike cities: pick the correct spelling, fold the rest in.
function Cluster({ group, busy, onMerge }) {
  const [keep, setKeep] = useState(group[0].city)
  const others = group.filter((c) => c.city !== keep)
  const working = busy === `->${keep}`

  return (
    <div className="dupe" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
      <div className="dupe-main" style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          {group.map((c) => (
            <Chip key={c.city} kind={c.city === keep ? 'ok' : ''}>{c.city} · {c.n}</Chip>
          ))}
        </div>
        <span className="dupe-sub">
          Keep{' '}
          <select value={keep} onChange={(e) => setKeep(e.target.value)}
                  style={{ display: 'inline-block', width: 'auto', padding: '2px 6px' }}>
            {group.map((c) => <option key={c.city} value={c.city}>{c.city}</option>)}
          </select>
          {' '}— fold the other {others.length} in
        </span>
      </div>
      <button className="btn btn-sm btn-primary" type="button" disabled={!!busy || !others.length}
              onClick={() => onMerge(others.map((o) => o.city), keep)}>
        {working ? 'Merging…' : `Merge → ${keep}`}
      </button>
    </div>
  )
}
