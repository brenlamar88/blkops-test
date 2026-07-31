import { useState } from 'react'

/* ------------------------------------------------------------------
   Lightweight SVG charts. No chart library ships with this app, and a
   dashboard of donuts does not justify one — these are ~4kB and match
   the instrument-panel styling directly.

   Palette validated with the dataviz skill's checker
   (node scripts/validate_palette.js, --mode light): all six pass the
   lightness band, chroma floor and normal-vision separation. Two pairs
   sit in the 6–8 CVD floor band, which is legal only alongside secondary
   encoding — every donut here ships a legend, a record-count table and
   2px segment gaps, so identity never rests on hue alone.
------------------------------------------------------------------ */

export const CAT_COLORS = [
  '#1f6fb0', '#d98324', '#2e9e6b', '#c02f7a', '#7a52c9', '#5b8f2a',
]
const OTHER_COLOR = '#94a1b0' // muted gray — "Other"/unknown, never a real series

// Colour follows the entity, not its rank: assign by a stable key order so a
// filter that drops a series never repaints the survivors.
export function colorMap(keys) {
  const stable = [...new Set(keys)].sort((a, b) => String(a).localeCompare(String(b)))
  const m = {}
  stable.forEach((k, i) => { m[k] = i < CAT_COLORS.length ? CAT_COLORS[i] : OTHER_COLOR })
  return m
}

// rows: [{ label, value, color }]  — pre-coloured, any order
export function Donut({ rows, size = 160, thickness = 24 }) {
  const [hover, setHover] = useState(null)
  const data = rows.filter((d) => d.value > 0)
  const total = data.reduce((s, d) => s + d.value, 0)

  if (!total) return <div className="donut-empty" style={{ height: size }}>No data</div>

  const r = (size - thickness) / 2
  const c = size / 2
  const C = 2 * Math.PI * r
  const gap = data.length > 1 ? 2 : 0

  let acc = 0
  const segs = data.map((d) => {
    const frac = d.value / total
    const s = { ...d, frac, start: acc }
    acc += frac
    return s
  })

  const active = hover != null ? segs[hover] : null
  const centerNum = active ? `${Math.round(active.frac * 100)}%` : total
  const centerSub = active ? active.label : 'total'

  return (
    <svg className="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`}
         role="img" aria-label="Distribution donut chart">
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--rule-soft)" strokeWidth={thickness} />
      {segs.map((s, i) => {
        const len = Math.max(s.frac * C - gap, 0.4)
        return (
          <circle key={i} cx={c} cy={c} r={r} fill="none"
                  stroke={s.color} strokeWidth={thickness}
                  strokeDasharray={`${len} ${C - len}`}
                  transform={`rotate(${s.start * 360 - 90} ${c} ${c})`}
                  style={{ opacity: active && active !== s ? 0.32 : 1,
                           transition: 'opacity .12s' }}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <title>{`${s.label}: ${s.value} (${Math.round(s.frac * 100)}%)`}</title>
          </circle>
        )
      })}
      <text x={c} y={c - 3} textAnchor="middle" dominantBaseline="middle" className="donut-num">
        {centerNum}
      </text>
      <text x={c} y={c + 14} textAnchor="middle" dominantBaseline="middle" className="donut-sub">
        {centerSub}
      </text>
    </svg>
  )
}

/* A donut paired with its record-count table — the redundant encoding that
   lets the palette pass CVD, and the exact shape of the old GravityView
   "X | Record Count" panels. */
export function DonutBlock({ title, keyLabel, rows }) {
  const total = rows.reduce((s, d) => s + d.value, 0)
  const ordered = [...rows].sort((a, b) => b.value - a.value)
  return (
    <div className="card">
      {title && <div className="card-head"><h2>{title}</h2></div>}
      <div className="donut-wrap">
        <Donut rows={rows} />
        <ul className="legend">
          {ordered.map((d) => (
            <li key={d.label}>
              <span className="sw" style={{ background: d.color }} />
              <span className="lg-label">{d.label}</span>
              <span className="lg-pct">{total ? Math.round((d.value / total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      </div>
      <table className="mini">
        <thead><tr><th>{keyLabel}</th><th className="num">Record Count</th></tr></thead>
        <tbody>
          {ordered.map((d, i) => (
            <tr key={d.label}>
              <td><span className="idx">{i + 1}.</span>{d.label}</td>
              <td className="num">{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const MiniPanel = ({ title, children }) => (
  <div className="card panel">
    <div className="panel-h">{title}</div>
    {children}
  </div>
)

export const NoData = () => <div className="nodata">No data</div>

// A titled breakdown that collapses to "No data" when empty — used for the
// admits and needs-analysis panels that are empty until that data loads.
export function BreakdownPanel({ title, keyLabel, rows }) {
  const ordered = [...(rows ?? [])].filter((d) => d.value > 0).sort((a, b) => b.value - a.value)
  return (
    <MiniPanel title={title}>
      {ordered.length ? (
        <table className="mini">
          <thead><tr><th>{keyLabel}</th><th className="num">Count</th></tr></thead>
          <tbody>
            {ordered.map((d) => (
              <tr key={d.label}><td>{d.label}</td><td className="num">{d.value}</td></tr>
            ))}
          </tbody>
        </table>
      ) : <NoData />}
    </MiniPanel>
  )
}
