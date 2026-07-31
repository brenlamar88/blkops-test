import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp, useQuery, fetchAll, save, remove, today, daysAgo, territoryForCity } from '../lib/data'
import { Field, Text, Select, Area, Check, DataTable, Banner, Empty, Loading, Chip } from '../components/ui'
import QuickAddContact from '../components/QuickAddContact'
import { fmtDate, fmtTime, personName } from '../lib/format'
import { UNIT_TYPES, CONTACT_METHODS, ACTIVITY_TYPES } from '../lib/enums'

const SEL = `*, user:profiles(first_name,last_name), company:companies(id,name),
  contact:contacts(first_name,last_name), stage:service_cycle_stages(short_label,rank)`

export function ActivityList() {
  const { facilityId, profile, lookups } = useApp()
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [user, setUser] = useState('')

  const { rows, loading, error, refresh } = useQuery(() => {
    if (!facilityId) return null
    return fetchAll(() => {
      let q = supabase.from('daily_activities').select(SEL)
        .eq('facility_id', facilityId)
        .gte('activity_date', from).lte('activity_date', to)
        .order('activity_date', { ascending: false }).order('id')
      if (user) q = q.eq('user_id', user)
      return q
    })
  }, [facilityId, from, to, user])

  const del = async (r) => {
    if (!confirm('Delete this activity?')) return
    try { await remove('daily_activities', r.id); refresh() } catch (e) { alert(e.message) }
  }

  const touches = rows.reduce((n, r) => n + (r.number_of_activities ?? 1), 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Activities</h1>
          <p>Every touch, in date order. One entry can cover several touches.</p>
        </div>
        <Link className="btn btn-primary" to="/activities/new">Log activity</Link>
      </div>

      <div className="kpis" style={{ marginBottom: 14 }}>
        <div className="kpi"><span className="l">Entries</span><span className="n">{rows.length}</span></div>
        <div className="kpi"><span className="l">Touches</span><span className="n">{touches}</span></div>
      </div>

      <div className="toolbar">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <span style={{ color: '#7d8fa1' }}>to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select value={user} onChange={(e) => setUser(e.target.value)}>
          <option value="">All reps</option>
          {(lookups.users ?? []).map((u) => <option key={u.id} value={u.id}>{personName(u)}</option>)}
        </select>
        <button type="button" className="btn btn-sm"
                onClick={() => { setUser(profile.id); setFrom(daysAgo(7)) }}>My last 7 days</button>
      </div>

      <div className="card">
        <DataTable rows={rows} loading={loading} error={error}
          empty={<Empty title="Nothing logged in this range"
                        body="Widen the dates, or log this week's visits."
                        action={<Link className="btn btn-primary" to="/activities/new">Log activity</Link>} />}
          columns={[
            { key: 'activity_date', label: 'Date', render: (r) => fmtDate(r.activity_date) },
            { key: 'time_of_activity', label: 'Time',
              render: (r) => <span className="mono">{fmtTime(r.time_of_activity)}</span> },
            { key: 'company', label: 'Company', sortValue: (r) => r.company?.name,
              render: (r) => r.company ? <Link to={`/companies/${r.company.id}`}>{r.company.name}</Link> : '—' },
            { key: 'activity_type', label: 'Activity' },
            { key: 'type_of_contact', label: 'Contact type' },
            { key: 'stage', label: 'Stage', sortValue: (r) => r.stage?.rank,
              render: (r) => r.stage?.short_label ? <Chip>{r.stage.short_label}</Chip> : '—' },
            { key: 'number_of_activities', label: '#', align: 'right' },
            { key: 'user', label: 'Rep', sortValue: (r) => r.user?.last_name,
              render: (r) => personName(r.user) },
            { key: 'a', label: '', sortable: false, render: (r) => (
                <div className="row-actions">
                  <Link className="btn btn-sm" to={`/activities/${r.id}/edit`}>Edit</Link>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => del(r)}>Delete</button>
                </div>) },
          ]} />
      </div>
    </>
  )
}

export function ActivityForm() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const { facilityId, profile, lookups } = useApp()
  const [v, setV] = useState({
    activity_date: today(), time_of_activity: null, company_id: params.get('company'),
    contact_id: null, territory_id: null, unit_type: null, type_of_contact: null,
    activity_type: null, service_cycle_stage_id: null, medical_director_name: null,
    decision_maker_name: null, number_of_activities: 1,
    scheduled_next_visit: false, next_visit_date: null, activity_information: null,
  })
  const [loaded, setLoaded] = useState(!id)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const { rows: companies } = useQuery(
    () => fetchAll(() => supabase.from('companies').select('id,name,city').eq('active', true)
      .is('merged_into_id', null).order('name').order('id')), [])

  const { rows: contacts, refresh: refreshContacts } = useQuery(
    () => v.company_id
      ? supabase.from('contacts').select('id,first_name,last_name')
          .eq('company_id', v.company_id).eq('active', true).order('last_name')
      : null, [v.company_id])

  useQuery(async () => {
    if (!id) return null
    const r = await supabase.from('daily_activities').select('*').eq('id', id).single()
    if (r.data) { setV(r.data); setLoaded(true) }
    return r
  }, [id])

  const set = (k) => (val) => setV((s) => {
    const n = { ...s, [k]: val }
    if (k === 'company_id') {
      n.contact_id = null
      // Fill territory from the company's city; the rep can still change it.
      const c = companies.find((x) => x.id === val)
      n.territory_id = territoryForCity(lookups.territoryCities, c?.city)
    }
    if (k === 'scheduled_next_visit' && !val) n.next_visit_date = null
    return n
  })

  const submit = async (e) => {
    e.preventDefault()
    if (v.scheduled_next_visit && !v.next_visit_date)
      return setError('You marked a next visit as scheduled — add the date.')
    setBusy(true); setError(null)
    try {
      const payload = { ...v, facility_id: v.facility_id ?? facilityId,
        user_id: v.user_id ?? profile.id,
        number_of_activities: Number(v.number_of_activities) || 1 }
      delete payload.created_at; delete payload.updated_at
      await save('daily_activities', id, payload)
      nav('/activities')
    } catch (err) { setError(err.message); setBusy(false) }
  }

  if (!loaded) return <Loading rows={7} />

  return (
    <form onSubmit={submit}>
      <div className="page-head"><div><h1>{id ? 'Edit activity' : 'Log activity'}</h1></div></div>
      <div className="card"><div className="card-body">
        <Banner kind="error">{error}</Banner>

        <div className="section-label" style={{ marginTop: 0 }}>When and where</div>
        <div className="grid">
          <Field label="Date" span={3} required>
            <Text value={v.activity_date} onChange={set('activity_date')} type="date" required />
          </Field>
          <Field label="Time" span={3}>
            <Text value={v.time_of_activity} onChange={set('time_of_activity')} type="time" />
          </Field>
          <Field label="Unit type" span={3}>
            <Select value={v.unit_type} onChange={set('unit_type')} options={UNIT_TYPES} />
          </Field>
          <Field label="Territory" span={3} hint="Fills in from the company's city.">
            <Select value={v.territory_id} onChange={set('territory_id')}
                    options={lookups.territories ?? []} />
          </Field>
          <Field label="Company" span={7}>
            <Select value={v.company_id} onChange={set('company_id')} options={companies} />
          </Field>
          <Field label="Contact" span={5}
                 hint={!v.company_id ? 'Pick a company to see its contacts.' : undefined}>
            <Select value={v.contact_id} onChange={set('contact_id')} disabled={!v.company_id}
                    options={(contacts ?? []).map((c) => [c.id, `${c.first_name} ${c.last_name}`])} />
            <QuickAddContact companyId={v.company_id}
              onAdded={(c) => { refreshContacts(); setV((s) => ({ ...s, contact_id: c.id })) }} />
          </Field>
        </div>

        <div className="section-label">What happened</div>
        <div className="grid">
          <Field label="Type of contact" span={4}>
            <Select value={v.type_of_contact} onChange={set('type_of_contact')} options={CONTACT_METHODS} />
          </Field>
          <Field label="Activity type" span={4}>
            <Select value={v.activity_type} onChange={set('activity_type')} options={ACTIVITY_TYPES} />
          </Field>
          <Field label="Number of activities" span={4} hint="One entry can cover several touches.">
            <Text value={v.number_of_activities} onChange={set('number_of_activities')}
                  type="number" min="1" />
          </Field>
          <Field label="Stage of service cycle" span={12}>
            <Select value={v.service_cycle_stage_id} onChange={set('service_cycle_stage_id')}
                    options={(lookups.stages ?? []).map((s) => [s.id, s.name])} />
          </Field>
          <Field label="Medical director / primary provider" span={6}>
            <Text value={v.medical_director_name} onChange={set('medical_director_name')} />
          </Field>
          <Field label="Utilization decision maker" span={6}>
            <Text value={v.decision_maker_name} onChange={set('decision_maker_name')} />
          </Field>
          <Field label="Activity information" span={12}>
            <Area value={v.activity_information} onChange={set('activity_information')}
                  placeholder="What was discussed, what you left behind, what to follow up on." />
          </Field>
        </div>

        <div className="section-label">Next visit</div>
        <div className="grid">
          <div className="f-4">
            <Check label="Next visit scheduled" value={v.scheduled_next_visit}
                   onChange={set('scheduled_next_visit')} />
          </div>
          <Field label="Next visit date" span={4}>
            <Text value={v.next_visit_date} onChange={set('next_visit_date')} type="date"
                  disabled={!v.scheduled_next_visit} />
          </Field>
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save activity'}</button>
          <button type="button" className="btn" onClick={() => nav(-1)}>Cancel</button>
        </div>
      </div></div>
    </form>
  )
}
