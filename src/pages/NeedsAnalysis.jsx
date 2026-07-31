import { useState, useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp, useQuery } from '../lib/data'
import { Field, Text, Select, Area, DataTable, Banner, Empty, Loading, Chip } from '../components/ui'
import { fmtDate, personName } from '../lib/format'
import { NA_TYPES, NA_SHAPE, UNIT_TYPES, RECOMMENDATIONS, MH_SETTINGS,
         TRAINING_NEEDS, ELDERCARE_FACILITY_TYPES, HOSPITAL_FACILITY_TYPES } from '../lib/enums'

export function NaList() {
  const [type, setType] = useState('')
  const [rec, setRec] = useState('')

  const { rows, loading, error } = useQuery(() => {
    let q = supabase.from('needs_analysis')
      .select('*, company:companies(id,name,city)')
      .order('last_updated_at', { ascending: false })
    if (type) q = q.eq('analysis_type', type)
    if (rec) q = q.eq('recommendation', rec)
    return q.limit(500)
  }, [type, rec])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Needs analysis</h1>
          <p>One per company. Every edit is kept with who made it and when, so you can
             see how an account's needs changed over time.</p>
        </div>
        <Link className="btn" to="/companies">Find a company</Link>
      </div>

      <div className="toolbar">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All forms</option>
          {NA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={rec} onChange={(e) => setRec(e.target.value)}>
          <option value="">All tiers</option>
          {RECOMMENDATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div className="card">
        <DataTable rows={rows} loading={loading} error={error}
          empty={<Empty title="No analyses yet"
                        body="Open a company and start one from its page."
                        action={<Link className="btn btn-primary" to="/companies">Find a company</Link>} />}
          columns={[
            { key: 'company', label: 'Company', sortValue: (r) => r.company?.name,
              render: (r) => r.company ? <Link to={`/companies/${r.company.id}`}>{r.company.name}</Link> : '—' },
            { key: 'analysis_type', label: 'Form', render: (r) => <Chip>{r.analysis_type}</Chip> },
            { key: 'recommendation', label: 'Recommendation' },
            { key: 'last_updated_at', label: 'Last updated',
              render: (r) => fmtDate(r.last_updated_at?.slice(0, 10)) },
            { key: 'a', label: '', sortable: false, render: (r) => (
                <div className="row-actions">
                  <Link className="btn btn-sm" to={`/needs-analysis/company/${r.company_id}`}>Update</Link>
                  <Link className="btn btn-sm" to={`/needs-analysis/${r.id}/history`}>History</Link>
                </div>) },
          ]} />
      </div>
    </>
  )
}

/* One form for all six types. Eldercare and Hospital write the facility
   detail row; the other four write the clinical row. */

export function NaForm() {
  const { companyId } = useParams()
  const nav = useNavigate()
  const { facilityId, lookups } = useApp()
  const [company, setCompany] = useState(null)
  const [existing, setExisting] = useState(null)
  const [base, setBase] = useState({ analysis_type: null, unit_type: null,
    recommendation: null, recommendation_reason: null, summary_of_prospect: null,
    territory_id: null })
  const [detail, setDetail] = useState({})
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let dead = false
    ;(async () => {
      const { data: co } = await supabase.from('companies')
        .select('*, category:categories(name)').eq('id', companyId).single()
      const { data: na } = await supabase.from('needs_analysis')
        .select('*').eq('company_id', companyId).maybeSingle()
      if (dead) return
      setCompany(co)
      if (na) {
        setExisting(na)
        setBase(na)
        const tbl = NA_SHAPE[na.analysis_type] === 'facility'
          ? 'needs_analysis_facility' : 'needs_analysis_clinical'
        const { data: d } = await supabase.from(tbl).select('*')
          .eq('needs_analysis_id', na.id).maybeSingle()
        if (!dead) setDetail(d ?? {})
      } else {
        // Default the form type from the company's category.
        const guess = { Eldercare: 'Eldercare', Hospitals: 'Hospital',
          Practitioners: 'Practitioner', 'Mental Health': 'Mental Health',
          Community: 'Community', 'Home Based Care': 'Home Based Care' }[co?.category?.name]
        setBase((s) => ({ ...s, analysis_type: guess ?? null }))
      }
      setLoaded(true)
    })()
    return () => { dead = true }
  }, [companyId])

  const shape = base.analysis_type ? NA_SHAPE[base.analysis_type] : null
  const setB = (k) => (v) => setBase((s) => ({ ...s, [k]: v }))
  const setD = (k) => (v) => setDetail((s) => ({ ...s, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!base.analysis_type) return setError('Pick which form applies.')
    setBusy(true); setError(null)
    try {
      const payload = {
        company_id: companyId, analysis_type: base.analysis_type,
        facility_id: base.facility_id ?? facilityId, territory_id: base.territory_id,
        unit_type: base.unit_type, recommendation: base.recommendation,
        recommendation_reason: base.recommendation_reason,
        summary_of_prospect: base.summary_of_prospect,
      }
      const { data: saved, error: e1 } = existing
        ? await supabase.from('needs_analysis').update(payload).eq('id', existing.id).select().single()
        : await supabase.from('needs_analysis').insert(payload).select().single()
      if (e1) throw new Error(e1.message)

      const tbl = shape === 'facility' ? 'needs_analysis_facility' : 'needs_analysis_clinical'
      const { error: e2 } = await supabase.from(tbl)
        .upsert({ ...detail, needs_analysis_id: saved.id }, { onConflict: 'needs_analysis_id' })
      if (e2) throw new Error(e2.message)

      nav(`/companies/${companyId}`)
    } catch (err) { setError(err.message); setBusy(false) }
  }

  if (!loaded) return <Loading rows={9} />
  if (!company) return <Empty title="Company not found" />

  return (
    <form onSubmit={submit}>
      <div className="page-head">
        <div>
          <h1>{existing ? 'Update' : 'Start'} needs analysis</h1>
          <p>{company.name}{company.city ? ` · ${company.city}` : ''}
             {existing ? ' — saving records a new revision, the old one is kept.' : ''}</p>
        </div>
        {existing && (
          <Link className="btn" to={`/needs-analysis/${existing.id}/history`}>History</Link>
        )}
      </div>

      <div className="card"><div className="card-body">
        <Banner kind="error">{error}</Banner>

        <div className="section-label" style={{ marginTop: 0 }}>Which form</div>
        <div className="grid">
          <Field label="Form type" span={4} required
                 hint={existing ? 'Changing this changes which detail fields apply.' : undefined}>
            <Select value={base.analysis_type} onChange={setB('analysis_type')} options={NA_TYPES} />
          </Field>
          <Field label="Unit type" span={4}>
            <Select value={base.unit_type} onChange={setB('unit_type')} options={UNIT_TYPES} />
          </Field>
          <Field label="Territory" span={4}>
            <Select value={base.territory_id} onChange={setB('territory_id')}
                    options={lookups.territories ?? []} />
          </Field>
        </div>

        {shape === 'facility' ? (
          <>
            <div className="section-label">Facility</div>
            <div className="grid">
              <Field label="Facility type" span={4}>
                {base.analysis_type === 'Eldercare'
                  ? <Select value={detail.eldercare_facility_type}
                            onChange={setD('eldercare_facility_type')}
                            options={ELDERCARE_FACILITY_TYPES} />
                  : <Select value={detail.hospital_facility_type}
                            onChange={setD('hospital_facility_type')}
                            options={HOSPITAL_FACILITY_TYPES} />}
              </Field>
              <Field label="Number of beds" span={4}>
                <Text value={detail.number_of_beds} onChange={setD('number_of_beds')} type="number" min="0" />
              </Field>
              <Field label="% with psych diagnosis" span={4}>
                <Text value={detail.pct_psych_diagnosis} onChange={setD('pct_psych_diagnosis')}
                      type="number" min="0" max="100" step="0.1" />
              </Field>
              <Field label="Medical director notes" span={6}>
                <Area value={detail.medical_director_notes} onChange={setD('medical_director_notes')} />
              </Field>
              <Field label="Other practitioners" span={6}>
                <Area value={detail.other_practitioner_notes} onChange={setD('other_practitioner_notes')} />
              </Field>
            </div>
          </>
        ) : shape === 'clinical' ? (
          <>
            <div className="section-label">Patient mix</div>
            <div className="grid">
              <Field label="Age range of patients seen" span={6}>
                <Text value={detail.age_range_of_patients} onChange={setD('age_range_of_patients')} />
              </Field>
              <Field label="% of patients with psych dx" span={6}>
                <Text value={detail.pct_psych_diagnosis} onChange={setD('pct_psych_diagnosis')}
                      type="number" min="0" max="100" step="0.1" />
              </Field>
            </div>
            <div className="section-label">Key people</div>
            <div className="grid">
              <Field label="Gatekeeper" span={4}>
                <Text value={detail.gatekeeper_name} onChange={setD('gatekeeper_name')} />
              </Field>
              <Field label="Office manager" span={4}>
                <Text value={detail.office_manager_name} onChange={setD('office_manager_name')} />
              </Field>
              <Field label="Nurse" span={4}>
                <Text value={detail.nurse_name} onChange={setD('nurse_name')} />
              </Field>
            </div>
            <div className="section-label">Referral pathway</div>
            <div className="grid">
              <Field label="Mental health services available" span={4}>
                <Select value={detail.mh_services_available} onChange={setD('mh_services_available')}
                        options={MH_SETTINGS} />
              </Field>
              <Field label="Primary choice for inpatient" span={8}>
                <Text value={detail.primary_inpatient_choice} onChange={setD('primary_inpatient_choice')} />
              </Field>
              <Field label="Needs more training?" span={4}>
                <Select value={detail.training_needed} onChange={setD('training_needed')}
                        options={TRAINING_NEEDS} />
              </Field>
              <Field label="How can we become their primary provider?" span={12}>
                <Area value={detail.how_become_primary} onChange={setD('how_become_primary')} />
              </Field>
            </div>
          </>
        ) : null}

        <div className="section-label">Assessment</div>
        <div className="grid">
          <Field label="Recommendation" span={4}>
            <Select value={base.recommendation} onChange={setB('recommendation')} options={RECOMMENDATIONS} />
          </Field>
          <Field label="Why?" span={8}>
            <Text value={base.recommendation_reason} onChange={setB('recommendation_reason')} />
          </Field>
          <Field label="Summary of prospect" span={12}>
            <Area value={base.summary_of_prospect} onChange={setB('summary_of_prospect')} />
          </Field>
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : existing ? 'Save update' : 'Save analysis'}
          </button>
          <button type="button" className="btn" onClick={() => nav(-1)}>Cancel</button>
        </div>
      </div></div>
    </form>
  )
}

export function NaHistory() {
  const { id } = useParams()
  const { rows: [na] = [] } = useQuery(
    () => supabase.from('needs_analysis').select('*, company:companies(id,name)').eq('id', id), [id])
  const { rows, loading, error } = useQuery(
    () => supabase.from('needs_analysis_revisions')
      .select('*, submitter:profiles(first_name,last_name)')
      .eq('needs_analysis_id', id).order('revision_number', { ascending: false }), [id])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analysis history</h1>
          <p>{na?.company?.name ?? ''} — every save, newest first. Nothing here is
             editable; it is the record of what changed and who changed it.</p>
        </div>
        {na && <Link className="btn" to={`/companies/${na.company_id}`}>Back to company</Link>}
      </div>

      <div className="card">
        <DataTable rows={rows} loading={loading} error={error}
          empty={<Empty title="No revisions yet" />}
          columns={[
            { key: 'revision_number', label: '#', align: 'right' },
            { key: 'submitted_at', label: 'When',
              render: (r) => new Date(r.submitted_at).toLocaleString('en-US',
                { month: 'short', day: '2-digit', year: 'numeric',
                  hour: 'numeric', minute: '2-digit' }) },
            { key: 'who', label: 'By', sortable: false,
              render: (r) => r.source === 'user' ? personName(r.submitter)
                : <Chip>{r.source}</Chip> },
            { key: 'kind', label: 'Change', sortable: false,
              render: (r) => r.is_initial ? <Chip kind="ok">Created</Chip> : <Chip>Updated</Chip> },
            { key: 'recommendation', label: 'Recommendation' },
            { key: 'beds', label: 'Beds', align: 'right', sortable: false,
              render: (r) => r.payload?.facility_detail?.number_of_beds ?? '—' },
            { key: 'gk', label: 'Gatekeeper', sortable: false,
              render: (r) => r.payload?.clinical_detail?.gatekeeper_name ?? '—' },
          ]} />
      </div>
    </>
  )
}
