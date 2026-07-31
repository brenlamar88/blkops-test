import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { territoryClass } from '../lib/format'

/* ---------------- Modal ----------------
   Portaled to <body> so it escapes any surrounding <form>: the modal can
   carry its own form, and Enter inside it never submits the page behind it.
   A bottom sheet on a phone, a centered card on desktop. */
export function Modal({ title, onClose, children }) {
  return createPortal(
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/* ---------------- Form fields ---------------- */

export function Field({ label, span = 6, required, hint, error, children }) {
  return (
    <div className={`field f-${span} ${required ? 'req' : ''}`}>
      {label && <label>{label}</label>}
      {children}
      {error ? <div className="err">{error}</div>
             : hint ? <div className="hint">{hint}</div> : null}
    </div>
  )
}

export function Text({ value, onChange, ...rest }) {
  return <input value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...rest} />
}

export function Area({ value, onChange, ...rest }) {
  return <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...rest} />
}

export function Select({ value, onChange, options, placeholder = '— Select —', ...rest }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...rest}>
      <option value="">{placeholder}</option>
      {options.map((o) => {
        const [val, lab] = Array.isArray(o) ? o : [o.id ?? o, o.name ?? o]
        return <option key={val} value={val}>{lab}</option>
      })}
    </select>
  )
}

export function Check({ label, value, onChange }) {
  return (
    <div className="check">
      <input type="checkbox" id={label} checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={label}>{label}</label>
    </div>
  )
}

/* ---------------- States ---------------- */

export const Banner = ({ kind = 'info', children }) =>
  children ? <div className={`banner ${kind}`}>{children}</div> : null

export const Loading = ({ rows = 5 }) => (
  <div style={{ padding: 14 }} aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="skeleton" style={{ marginBottom: 9, width: `${94 - i * 9}%` }} />
    ))}
  </div>
)

export const Empty = ({ title, body, action }) => (
  <div className="empty">
    <h3>{title}</h3>
    {body && <p>{body}</p>}
    {action}
  </div>
)

export const Chip = ({ children, kind = '' }) => <span className={`chip ${kind}`}>{children}</span>

export const TerritoryChip = ({ name }) =>
  name ? <Chip kind={territoryClass(name)}>{name}</Chip> : <span style={{ color: '#7d8fa1' }}>—</span>

/* ---------------- Table ----------------
   Columns: { key, label, render?, csv?, align?, sortable? }
   Sorting is client-side over the loaded page — these lists are
   territory-scoped and rarely exceed a few hundred rows.
--------------------------------------- */

export function DataTable({ columns, rows, loading, error, empty, territoryOf }) {
  const [sort, setSort] = useState({ key: null, dir: 'asc' })

  const sorted = useMemo(() => {
    if (!sort.key) return rows
    const col = columns.find((c) => c.key === sort.key)
    const val = (r) => (col?.sortValue ? col.sortValue(r) : r[sort.key]) ?? ''
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b)
      const cmp = typeof x === 'number' && typeof y === 'number'
        ? x - y : String(x).localeCompare(String(y))
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, sort, columns])

  if (loading) return <Loading />
  if (error) return <Banner kind="error">{error}</Banner>
  if (!rows.length) return empty ?? <Empty title="Nothing here yet" />

  const toggle = (key) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}
                  className={c.sortable === false ? '' : 'sortable'}
                  onClick={c.sortable === false ? undefined : () => toggle(c.key)}
                  aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.id ?? i}>
              {columns.map((c, ci) => (
                <td key={c.key}
                    className={[
                      ci === 0 && territoryOf ? `rail ${territoryClass(territoryOf(r))}` : '',
                      c.align === 'right' ? 'num' : '',
                    ].filter(Boolean).join(' ')}>
                  {c.render ? c.render(r) : (r[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
