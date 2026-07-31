import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

/* ------------------------------------------------------------------
   Type-to-search company picker. Replaces a native <select> that could
   hold thousands of options — unworkable on a phone. Queries the server
   as you type (debounced) and shows a short, tappable result list, so it
   scales no matter how many companies exist.

   onChange receives the whole company row (id, name, city, category_id,
   subcategory_id) or null, so the forms can prefill territory and category
   from it. Enter selects the top match and never submits the parent form.
------------------------------------------------------------------ */

const SELECT = 'id,name,city,category_id,subcategory_id'

export default function CompanyPicker({ value, onChange, placeholder = 'Search company or city…' }) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const box = useRef(null)

  // Show the name for a value set from outside (edit mode, or ?company= link).
  useEffect(() => {
    let dead = false
    if (!value) { setSelected(null); return }
    if (selected?.id === value) return
    supabase.from('companies').select(SELECT).eq('id', value).maybeSingle()
      .then(({ data }) => { if (!dead && data) setSelected(data) })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Debounced server search while the menu is open.
  useEffect(() => {
    if (!open) return
    const t = term.trim()
    if (t.length < 2) { setResults([]); setLoading(false); return }
    setLoading(true)
    const h = setTimeout(async () => {
      const s = `%${t}%`
      const { data } = await supabase.from('companies').select(SELECT)
        .eq('active', true).is('merged_into_id', null)
        .or(`name.ilike.${s},city.ilike.${s}`)
        .order('name').limit(25)
      setResults(data ?? [])
      setLoading(false)
    }, 220)
    return () => clearTimeout(h)
  }, [term, open])

  // Close when tapping outside.
  useEffect(() => {
    const onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (c) => { setSelected(c); onChange?.(c); setOpen(false); setTerm('') }
  const clear = () => { setSelected(null); onChange?.(null); setTerm(''); setOpen(true) }
  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (results.length) pick(results[0]) }
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="cpick" ref={box}>
      {selected && !open ? (
        <div className="cpick-selected">
          <span className="cpick-name caps">
            {selected.name}{selected.city ? ` · ${selected.city}` : ''}
          </span>
          <button type="button" className="cpick-clear"
                  onClick={() => { setOpen(true); setTerm('') }}>Change</button>
        </div>
      ) : (
        <>
          <input className="cpick-input" value={term} placeholder={placeholder} inputMode="search"
                 autoFocus={open && !!selected}
                 onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
                 onChange={(e) => { setTerm(e.target.value); setOpen(true) }} />
          {open && (
            <div className="cpick-menu">
              {selected && (
                <button type="button" className="cpick-item cpick-clearrow" onClick={clear}>
                  <span className="cpick-item-sub">Clear selection</span>
                </button>
              )}
              {loading ? <div className="cpick-msg">Searching…</div>
               : term.trim().length < 2 ? <div className="cpick-msg">Type at least 2 letters.</div>
               : results.length === 0 ? <div className="cpick-msg">No matches.</div>
               : results.map((c) => (
                  <button type="button" key={c.id} className="cpick-item" onClick={() => pick(c)}>
                    <span className="cpick-item-name caps">{c.name}</span>
                    {c.city && <span className="cpick-item-sub">{c.city}</span>}
                  </button>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
