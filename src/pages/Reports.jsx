import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp, useQuery, fetchAll, today, daysAgo } from '../lib/data'
import { DataTable, Empty, Banner, Chip } from '../components/ui'
import { fmtDate, personName } from '../lib/format'
import { downloadCsv } from '../lib/csv'

export default function Reports() {
  const { facilityId, lookups } = useApp()
  const [which, setWhich] = useState('productivity')
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())

  const nameOf = (uid) => personName((lookups.users ?? []).find((u) => u.id === uid))

  // Rep productivity comes off the revision ledger: one row per save,
  // whether that save created an analysis or edited one.
  const prod = useQuery(() => which !== 'productivity' ? null
    : fetchAll(() => supabase.from('needs_analysis_revisions')
        .select('submitted_by, is_initial, submitted_at, source, id')
        .eq('source', 'user')
        .gte('submitted_at', from).lte('submitted_at', to + 'T23:59:59')
        .order('id')), [which, from, to])

  const acts = useQuery(() => which !== 'activities' || !facilityId ? null
    : fetchAll(() => supabase.from('daily_activities')
        .select(`*, user:profiles(first_name,last_name), company:companies(name),
                 stage:service_cycle_stages(short_label)`)
        .eq('facility_id', facilityId)
        .gte('activity_date', from).lte('activity_date', to)
        .order('activity_date', { ascending: false }).order('id')),
    [which, facilityId, from, to])

  const refs = useQuery(() => which !== 'referrals' || !facilityId ? null
    : fetchAll(() => supabase.from('referrals')
        .select(`*, submitter:profiles(first_name,last_name), company:companies(name),
                 denial:denial_reasons(name)`)
        .eq('facility_id', facilityId)
        .gte('referral_date', from).lte('referral_date', to)
        .order('referral_date', { ascending: false }).order('id')),
    [which, facilityId, from, to])

  const prodRows = (() => {
    const by = {}
    for (const r of prod.rows) {
      const k = r.submitted_by
      by[k] = by[k] ?? { submitted_by: k, new_analyses: 0, updates: 0, total: 0 }
      if (r.is_initial) by[k].new_analyses++; else by[k].updates++
      by[k].total++
    }
    return Object.values(by).sort((a, b) => b.total - a.total)
  })()

  const defs = {
    productivity: {
      label: 'Needs analysis by rep',
      blurb: 'Counts every save — a new analysis and an edit each count as one submission.',
      state: prod, rows: prodRows, file: 'needs-analysis-by-rep',
      columns: [
        { key: 'rep', label: 'Rep', csv: (r) => nameOf(r.submitted_by),
          render: (r) => nameOf(r.submitted_by) },
        { key: 'new_analyses', label: 'New', align: 'right' },
        { key: 'updates', label: 'Updates', align: 'right' },
        { key: 'total', label: 'Total submissions', align: 'right' },
      ],
    },
    activities: {
      label: 'Activity log',
      blurb: 'Every logged touch for this campus.',
      state: acts, rows: acts.rows, file: 'activity-log',
      columns: [
        { key: 'activity_date', label: 'Date', render: (r) => fmtDate(r.activity_date) },
        { key: 'company', label: 'Company', csv: (r) => r.company?.name,
          render: (r) => r.company?.name ?? '—' },
        { key: 'activity_type', label: 'Activity' },
        { key: 'type_of_contact', label: 'Contact type' },
        { key: 'stage', label: 'Stage', csv: (r) => r.stage?.short_label,
          render: (r) => r.stage?.short_label ?? '—' },
        { key: 'number_of_activities', label: 'Touches', align: 'right' },
        { key: 'user', label: 'Rep', csv: (r) => personName(r.user),
          render: (r) => personName(r.user) },
        { key: 'activity_information', label: 'Notes' },
      ],
    },
    referrals: {
      label: 'Referral log',
      blurb: 'Referrals with outcome and denial reason.',
      state: refs, rows: refs.rows, file: 'referral-log',
      columns: [
        { key: 'referral_date', label: 'Date', render: (r) => fmtDate(r.referral_date) },
        { key: 'patient', label: 'Patient',
          csv: (r) => `${r.patient_first_name ?? ''} ${r.patient_last_initial ?? ''}`,
          render: (r) => `${r.patient_first_name ?? '?'} ${r.patient_last_initial ?? '?'}.` },
        { key: 'company', label: 'Referred by', csv: (r) => r.company?.name,
          render: (r) => r.company?.name ?? '—' },
        { key: 'admission_status', label: 'Outcome',
          render: (r) => r.admission_status ?? 'Pending' },
        { key: 'denial', label: 'Denial reason', csv: (r) => r.denial?.name,
          render: (r) => r.denial?.name ?? '—' },
        { key: 'admit_denial_date', label: 'Decision date',
          render: (r) => r.admit_denial_date ? fmtDate(r.admit_denial_date) : '—' },
        { key: 'submitter', label: 'Rep', csv: (r) => personName(r.submitter),
          render: (r) => personName(r.submitter) },
      ],
    },
  }

  const d = defs[which]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>Filter, check it on screen, then take it to Excel.</p>
        </div>
        <div className="row-actions">
          <button className="btn" type="button" onClick={() => window.print()}>Print</button>
          <button className="btn btn-primary" type="button" disabled={!d.rows.length}
                  onClick={() => downloadCsv(`${d.file}-${from}-to-${to}.csv`, d.columns, d.rows)}>
            Download CSV
          </button>
        </div>
      </div>

      <div className="toolbar">
        <select value={which} onChange={(e) => setWhich(e.target.value)}>
          {Object.entries(defs).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <span style={{ color: '#7d8fa1' }}>to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <div className="spacer" />
        <span className="mono" style={{ color: '#7d8fa1', fontSize: 12 }}>
          {d.state.loading ? '' : `${d.rows.length} rows`}
        </span>
      </div>

      <Banner kind="info">{d.blurb}</Banner>

      <div className="card">
        <DataTable columns={d.columns} rows={d.rows}
          loading={d.state.loading} error={d.state.error}
          empty={<Empty title="Nothing to report yet"
                        body="No records fall inside these filters." />} />
      </div>
    </>
  )
}
