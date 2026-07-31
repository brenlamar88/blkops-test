export const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US',
  { month: 'short', day: '2-digit', year: 'numeric' }) : '—')

export const fmtTime = (t) => {
  if (!t) return '—'
  const [h, m] = t.split(':')
  const hh = +h % 12 || 12
  return `${hh}:${m} ${+h < 12 ? 'AM' : 'PM'}`
}

export const personName = (p) =>
  p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || '—' : '—'

// Territory names are a fixed set from the business (Red/White/Blue/Gold).
// Anything else falls through to a neutral chip rather than breaking.
export const territoryClass = (name) => {
  const k = (name || '').toLowerCase()
  return ['red', 'white', 'blue', 'gold'].includes(k) ? `t-${k}` : ''
}
