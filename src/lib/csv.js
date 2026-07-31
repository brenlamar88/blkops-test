// CSV export for the reporting views. Quotes every field so notes
// containing commas, quotes, or newlines survive the trip to Excel.
const esc = (v) => (v === null || v === undefined)
  ? '""' : '"' + String(v).replace(/"/g, '""') + '"'

export function toCsv(columns, rows) {
  const head = columns.map((c) => esc(c.label)).join(',')
  const body = rows.map((r) =>
    columns.map((c) => esc(c.csv ? c.csv(r) : r[c.key])).join(','))
  return [head, ...body].join('\r\n')
}

export function downloadCsv(filename, columns, rows) {
  // BOM keeps Excel from mangling accented facility names.
  const blob = new Blob(['\uFEFF' + toCsv(columns, rows)], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
