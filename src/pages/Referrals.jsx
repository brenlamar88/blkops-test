import { useState, useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp, useQuery, save, today, daysAgo, territoryForCity } from '../lib/data'
import { Field, Text, Select, Area, Check, DataTable, Banner, Empty, Loading, Chip, TerritoryChip } from '../components/ui'
import QuickAddContact from '../components/QuickAddContact'
import { fmtDate, personName } from '../lib/format'
import { UNIT_TYPES, ADMISSION_STATUSES } from '../lib/enums'

const SEL = `*, submitter:profiles(first_name,last_name), territory:territories(name),
  company:companies(id,name,city), denial:denial_reasons(name),
  pins:payer_sources!referrals_primary_insurance_id_fkey(name)`

export function ReferralList() {
  const { facilityId, lookups } = useApp()
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [status, setStatus] = useState('')

  const { rows, loading, error } = useQuery(() => {
    if (!facilityId) return null
    let q = supabase.from('referrals').select(SEL).eq('facility_id', facilityId)
      .gte('referral_date', from).lte('referral_date', to)
      .order('referral_date', { ascending: false })
    if (status) q = q.eq('admission_status', status)
    return q.limit(500)
  }, [facilityId, from, to, status])

  const s = useMemo(() => {
    const a = rows.filter((r) => r.admission_status === 'Admit').length
    const d = rows.filter((r) => r.admission_status === 'Denial').length
    const p = rows.filter((r) => r.admission_status === 'Pending' || !r.admission_status).length
    return { a, d, p, rate: a + d ? Math.round((a / (a + d)) * 100) : null }
  }, [rows])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Referrals</h1>
          <p>Referral log with admit and denial outcomes. Patient identity is limited to
             three letters and an initial, same as the paper form.</p>
        </div>
        <Link className="btn btn-primary" to="/referrals/new">Log referral</Link>
      </div>

      <div className="kpis" style={{ marginBottom: 14 }}>
        <div className="kpi"><span className="l">Referrals</span><span className="n">{rows.length}</span></div>
        <div className="kpi"><span className="l">Admits</span><span className="n">{s.a}</span></div>
        <div className="kpi"><span className="l">Denials</span><span className="n">{s.d}</span></div>
        <div className="kpi"><span className="l">Pending</span><span className="n">{s.p}</span></div>
        <div className="kpi"><span className="l">Admit rate</span>
          <span className="n">{s.rate === null ? '—' : `${s.rate}%`}</span></div>
      </div>

      <div className="toolbar">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <span style={{ color: '#7d8fa1' }}>to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All outcomes</option>
          {ADMISSION_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>

      <div className="card">
        <DataTable rows={rows} loading={loading} error={error}
          territoryOf={(r) => r.territory?.name}
          empty={<Empty title="No referrals in this range"
                        action={<Link className="btn btn-primary" to="/referrals/new">Log referral</Link>} />}
          columns={[
            { key: 'referral_date', label: 'Date', render: (r) => fmtDate(r.referral_date) },
            { key: 'patient', label: 'Patient', sortable: false,
              render: (r) => <span className="mono">
                {`${r.patient_first_name ?? '?'} ${r.patient_last_initial ?? '?'}.`}</span> },
            { key: 'company', label: 'Referred by', sortValue: (r) => r.company?.name,
              render: (r) => r.company ? <Link to={`/companies/${r.company.id}`}>{r.company.name}</Link> : '—' },
            { key: 'territory', label: 'Territory', sortable: false,
              render: (r) => <TerritoryChip name={r.territory?.name} /> },
            { key: 'admission_status', label: 'Outcome',
              render: (r) => r.admission_status
                ? <Chip kind={r.admission_status === 'Admit' ? 'ok'
                        : r.admission_status === 'Denial' ? 'bad' : ''}>
                    {r.admission_status}</Chip>
                : <Chip>Pending</Chip> },
            { key: 'denial', label: 'Denial reason', sortable: false,
              render: (r) => r.denial?.name ?? '—' },
            { key: 'pins', label: 'Primary payer', sortable: false,
              render: (r) => r.pins?.name ?? '—' },
            { key: 'submitter', label: 'Rep', sortValue: (r) => r.submitter?.last_name,
              render: (r) => personName(r.submitter) },
            { key: 'a', label: '', sortable: false,
              render: (r) => <Link className="btn btn-sm" to={`/referrals/${r.id}/edit`}>Edit</Link> },
          ]} />
      </div>
    </>
  )
}

export function ReferralForm() {
  const { id } = useParams()
  const nav = useNavigate()
  const { facilityId, profile, lookups } = useApp()
  const [v, setV] = useState({
    referral_date: today(), time_of_submission: null, territory_id: null,
    patient_first_name: null, patient_last_initial: null,
    prospect_company_id: null, referral_contact_id: null,
    category_id: null, subcategory_id: null, referral_unit_type: null,
    primary_insurance_id: null, secondary_insurance_id: null,
    prescreening_performed: false, prescreen_location_id: null,
    admission_status: null, admit_denial_date: null, denial_reason_id: null, notes: null,
  })
  const [loaded, setLoaded] = useState(!id)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const { rows: companies } = useQuery(
    () => supabase.from('companies').select('id,name,city,category_id,subcategory_id')
      .eq('active', true).is('merged_into_id', null).order('name').limit(1000), [])

  const { rows: contacts, refresh: refreshContacts } = useQuery(
    () => v.prospect_company_id
      ? supabase.from('contacts').select('id,first_name,last_name')
          .eq('company_id', v.prospect_company_id).eq('active', true).order('last_name')
      : null, [v.prospect_company_id])

  useQuery(async () => {
    if (!id) return null
    const r = await supabase.from('referrals').select('*').eq('id', id).single()
    if (r.data) { setV(r.data); setLoaded(true) }
    return r
  }, [id])

  const set = (k) => (val) => setV((s) => {
    const n = { ...s, [k]: val }
    if (k === 'prospect_company_id') {
      const c = companies.find((x) => x.id === val)
      if (c) Object.assign(n, { referral_contact_id: null,
        category_id: c.category_id, subcategory_id: c.subcategory_id,
        // Territory fills in from the referring company's city; still editable.
        territory_id: territoryForCity(lookups.territoryCities, c.city) })
    }
    if (k === 'category_id') n.subcategory_id = null
    if (k === 'admission_status' && val !== 'Denial') n.denial_reason_id = null
    if (k === 'prescreening_performed' && !val) n.prescreen_location_id = null
    return n
  })

  const subs = useMemo(
    () => (lookups.subcategories ?? []).filter((s) => s.category_id === v.category_id),
    [lookups.subcategories, v.category_id])

  const submit = async (e) => {
    e.preventDefault()
    if (v.admission_status === 'Denial' && !v.denial_reason_id)
      return setError('A denial needs a reason — the database will reject it otherwise.')
    setBusy(true); setError(null)
    try {
      const payload = { ...v, facility_id: v.facility_id ?? facilityId,
        submitted_by: v.submitted_by ?? profile.id }
      delete payload.created_at; delete payload.updated_at
      await save('referrals', id, payload)
      nav('/referrals')
    } catch (err) { setError(err.message); setBusy(false) }
  }

  if (!loaded) return <Loading rows={8} />

  return (
    <form onSubmit={submit}>
      <div className="page-head"><div><h1>{id ? 'Edit referral' : 'Log referral'}</h1></div></div>
      <div className="card"><div className="card-body">
        <Banner kind="error">{error}</Banner>

        <div className="section-label" style={{ marginTop: 0 }}>Referral</div>
        <div className="grid">
          <Field label="Date" span={3} required>
            <Text value={v.referral_date} onChange={set('referral_date')} type="date" required />
          </Field>
          <Field label="Time" span={3}>
            <Text value={v.time_of_submission} onChange={set('time_of_submission')} type="time" />
          </Field>
          <Field label="Patient first name" span={3} hint="Three letters max.">
            <Text value={v.patient_first_name} onChange={set('patient_first_name')} maxLength={3} className="mono" />
          </Field>
          <Field label="Patient last initial" span={3} hint="One letter.">
            <Text value={v.patient_last_initial} onChange={set('patient_last_initial')} maxLength={1} className="mono" />
          </Field>
        </div>

        <div className="section-label">Source</div>
        <div className="grid">
          <Field label="Referring company" span={7} hint="Category fills in from the company.">
            <Select value={v.prospect_company_id} onChange={set('prospect_company_id')} options={companies} />
          </Field>
          <Field label="Referring contact" span={5}>
            <Select value={v.referral_contact_id} onChange={set('referral_contact_id')}
                    disabled={!v.prospect_company_id}
                    options={(contacts ?? []).map((c) => [c.id, `${c.first_name} ${c.last_name}`])} />
            <QuickAddContact companyId={v.prospect_company_id}
              onAdded={(c) => { refreshContacts(); setV((s) => ({ ...s, referral_contact_id: c.id })) }} />
          </Field>
          <Field label="Territory" span={4} hint="Fills in from the referring company's city.">
            <Select value={v.territory_id} onChange={set('territory_id')} options={lookups.territories ?? []} />
          </Field>
          <Field label="Category" span={4}>
            <Select value={v.category_id} onChange={set('category_id')} options={lookups.categories ?? []} />
          </Field>
          <Field label="Subcategory" span={4}>
            <Select value={v.subcategory_id} onChange={set('subcategory_id')}
                    options={subs} disabled={!v.category_id} />
          </Field>
        </div>

        <div className="section-label">Coverage</div>
        <div className="grid">
          <Field label="Primary insurance" span={6}>
            <Select value={v.primary_insurance_id} onChange={set('primary_insurance_id')}
                    options={lookups.payerSources ?? []} />
          </Field>
          <Field label="Secondary insurance" span={6}>
            <Select value={v.secondary_insurance_id} onChange={set('secondary_insurance_id')}
                    options={lookups.payerSources ?? []} />
          </Field>
        </div>

        <div className="section-label">Prescreening and outcome</div>
        <div className="grid">
          <div className="f-4">
            <Check label="Prescreening performed" value={v.prescreening_performed}
                   onChange={set('prescreening_performed')} />
          </div>
          <Field label="Prescreening location" span={8}>
            <Select value={v.prescreen_location_id} onChange={set('prescreen_location_id')}
                    options={lookups.prescreenLocations ?? []}
                    disabled={!v.prescreening_performed} />
          </Field>
          <Field label="Unit referred to" span={4}>
            <Select value={v.referral_unit_type} onChange={set('referral_unit_type')} options={UNIT_TYPES} />
          </Field>
          <Field label="Outcome" span={4}>
            <Select value={v.admission_status} onChange={set('admission_status')}
                    options={ADMISSION_STATUSES} placeholder="— Not decided —" />
          </Field>
          <Field label="Admit / denial date" span={4}>
            <Text value={v.admit_denial_date} onChange={set('admit_denial_date')} type="date" />
          </Field>
          {v.admission_status === 'Denial' && (
            <Field label="Denial reason" span={12} required>
              <Select value={v.denial_reason_id} onChange={set('denial_reason_id')}
                      options={lookups.denialReasons ?? []} />
            </Field>
          )}
          <Field label="Notes" span={12}><Area value={v.notes} onChange={set('notes')} /></Field>
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save referral'}</button>
          <button type="button" className="btn" onClick={() => nav(-1)}>Cancel</button>
        </div>
      </div></div>
    </form>
  )
}
