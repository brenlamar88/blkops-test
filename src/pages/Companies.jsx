import { useState, useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp, useQuery, fetchAll, save, territoryForCity } from '../lib/data'
import { Field, Text, Select, Area, DataTable, Banner, Empty, Loading, Chip, TerritoryChip } from '../components/ui'
import { fmtDate } from '../lib/format'

const SEL = `*, category:categories(id,name), subcategory:subcategories(id,name)`

export function CompanyList() {
  const { lookups, facilityId } = useApp()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')

  const { rows, loading, error } = useQuery(() => fetchAll(() => {
    let q = supabase.from('companies').select(SEL)
      .eq('active', true).is('merged_into_id', null).order('name').order('id')
    if (category) q = q.eq('category_id', category)
    if (search.trim()) {
      const s = `%${search.trim()}%`
      q = q.or(`name.ilike.${s},city.ilike.${s}`)
    }
    return q
  }), [search, category])

  // Territory for this account, derived from its city via the selected
  // campus's map — the same resolution the forms and database use.
  const terrName = (tid) => (lookups.territories ?? []).find((t) => t.id === tid)?.name
  const coTerr = (r) => terrName(territoryForCity(lookups.territoryCities, r.city))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Companies</h1>
          <p>Every account, shared across campuses. Add one here and it is available
             on every form — no dropdown to edit.</p>
        </div>
        <Link className="btn btn-primary" to="/companies/new">Add company</Link>
      </div>

      <div className="toolbar">
        <input placeholder="Search company or city…" value={search}
               onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 230 }} />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {(lookups.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="spacer" />
        <span className="mono" style={{ color: '#7d8fa1', fontSize: 12 }}>
          {loading ? '' : `${rows.length} shown`}
        </span>
      </div>

      <div className="card">
        <DataTable rows={rows} loading={loading} error={error} territoryOf={coTerr}
          empty={<Empty title="No companies yet"
                        body="Add your first account, or import from the old sites."
                        action={<Link className="btn btn-primary" to="/companies/new">Add company</Link>} />}
          columns={[
            { key: 'name', label: 'Company',
              render: (r) => <Link to={`/companies/${r.id}`}>{r.name}</Link> },
            { key: 'category', label: 'Category', sortValue: (r) => r.category?.name,
              render: (r) => r.category?.name ?? '—' },
            { key: 'city', label: 'City' },
            { key: 'territory', label: 'Territory', sortable: false,
              render: (r) => <TerritoryChip name={coTerr(r)} /> },
            { key: 'phone', label: 'Phone',
              render: (r) => r.phone ? <a className="mono" href={`tel:${r.phone}`}>{r.phone}</a> : '—' },
            { key: 'actions', label: '', sortable: false,
              render: (r) => <Link className="btn btn-sm" to={`/companies/${r.id}/edit`}>Edit</Link> },
          ]} />
      </div>
    </>
  )
}

const BLANK = { name: '', category_id: null, subcategory_id: null, practitioner_type_id: null,
  address_line1: null, city: null, state: 'LA', zip: null, website: null,
  phone: null, fax: null, notes: null }

export function CompanyForm() {
  const { id } = useParams()
  const nav = useNavigate()
  const { lookups, profile, facilityId } = useApp()
  const [v, setV] = useState(BLANK)
  const [loaded, setLoaded] = useState(!id)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useQuery(async () => {
    if (!id) return null
    const r = await supabase.from('companies').select('*').eq('id', id).single()
    if (r.data) { setV(r.data); setLoaded(true) }
    return r
  }, [id])

  const set = (k) => (val) => setV((s) => ({
    ...s, [k]: val, ...(k === 'category_id' ? { subcategory_id: null } : {}),
  }))

  const subs = useMemo(
    () => (lookups.subcategories ?? []).filter((s) => s.category_id === v.category_id),
    [lookups.subcategories, v.category_id])

  const submit = async (e) => {
    e.preventDefault()
    if (!v.name?.trim()) return setError('Company name is required.')
    setBusy(true); setError(null)
    try {
      const org = (lookups.categories ?? [])[0]?.organization_id
      const payload = { ...v, created_by: v.created_by ?? profile.id,
        organization_id: v.organization_id ?? org }
      delete payload.created_at; delete payload.updated_at
      const saved = await save('companies', id, payload)
      // Link the account to the campus you are working from.
      if (facilityId) {
        await supabase.from('facility_companies')
          .upsert({ facility_id: facilityId, company_id: saved.id },
                  { onConflict: 'facility_id,company_id' })
      }
      nav(`/companies/${saved.id}`)
    } catch (err) { setError(err.message); setBusy(false) }
  }

  if (!loaded) return <Loading rows={7} />

  return (
    <form onSubmit={submit}>
      <div className="page-head"><div><h1>{id ? 'Edit company' : 'Add company'}</h1></div></div>
      <div className="card"><div className="card-body">
        <Banner kind="error">{error}</Banner>
        <div className="section-label" style={{ marginTop: 0 }}>Identity</div>
        <div className="grid">
          <Field label="Company name" span={8} required>
            <Text value={v.name} onChange={set('name')} autoFocus />
          </Field>
          <Field label="Category" span={4}>
            <Select value={v.category_id} onChange={set('category_id')}
                    options={lookups.categories ?? []} />
          </Field>
          <Field label="Subcategory" span={6}
                 hint={!v.category_id ? 'Pick a category first.' : undefined}>
            <Select value={v.subcategory_id} onChange={set('subcategory_id')}
                    options={subs} disabled={!v.category_id} />
          </Field>
          <Field label="Practitioner type" span={6}>
            <Select value={v.practitioner_type_id} onChange={set('practitioner_type_id')}
                    options={lookups.practitionerTypes ?? []} />
          </Field>
        </div>
        <div className="section-label">Location</div>
        <div className="grid">
          <Field label="Address" span={12}><Text value={v.address_line1} onChange={set('address_line1')} /></Field>
          <Field label="City" span={6}><Text value={v.city} onChange={set('city')} /></Field>
          <Field label="State" span={3}><Text value={v.state} onChange={set('state')} maxLength={2} /></Field>
          <Field label="ZIP" span={3}><Text value={v.zip} onChange={set('zip')} /></Field>
        </div>
        <div className="section-label">Contact</div>
        <div className="grid">
          <Field label="Phone" span={4}><Text value={v.phone} onChange={set('phone')} /></Field>
          <Field label="Fax" span={4}><Text value={v.fax} onChange={set('fax')} /></Field>
          <Field label="Website" span={4}><Text value={v.website} onChange={set('website')} /></Field>
          <Field label="Notes" span={12}><Area value={v.notes} onChange={set('notes')} /></Field>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save company'}</button>
          <button type="button" className="btn" onClick={() => nav(-1)}>Cancel</button>
        </div>
      </div></div>
    </form>
  )
}

export function CompanyDetail() {
  const { id } = useParams()
  const { lookups } = useApp()
  const { rows: [co] = [], loading } = useQuery(
    () => supabase.from('companies').select(SEL).eq('id', id), [id])
  const coTerr = (lookups.territories ?? [])
    .find((t) => t.id === territoryForCity(lookups.territoryCities, co?.city))?.name
  const { rows: contacts } = useQuery(
    () => supabase.from('contacts').select('*, role:contact_roles(name)')
      .eq('company_id', id).eq('active', true).order('last_name'), [id])
  const { rows: acts } = useQuery(
    () => supabase.from('daily_activities')
      .select('*, stage:service_cycle_stages(short_label)')
      .eq('company_id', id).order('activity_date', { ascending: false }).limit(10), [id])
  const { rows: [na] = [] } = useQuery(
    () => supabase.from('needs_analysis').select('*').eq('company_id', id), [id])

  if (loading) return <Loading rows={8} />
  if (!co) return <Empty title="Company not found" />

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="caps">{co.name}</h1>
          <p className="caps">{[co.category?.name, co.subcategory?.name, co.city, co.state]
                .filter(Boolean).join(' · ')}</p>
          {coTerr && <div style={{ marginTop: 6 }}><TerritoryChip name={coTerr} /></div>}
        </div>
        <div className="row-actions">
          <Link className="btn" to={`/companies/${id}/edit`}>Edit</Link>
          <Link className="btn btn-primary" to={`/activities/new?company=${id}`}>Log activity</Link>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h2>Needs analysis</h2>
          <Link className="btn btn-sm btn-primary" to={`/needs-analysis/company/${id}`}>
            {na ? 'Update' : 'Start'}
          </Link>
        </div>
        <div className="card-body">
          {na ? (
            <div style={{ fontSize: 13 }}>
              {na.analysis_type} · {na.recommendation ?? 'no recommendation yet'} ·
              {' '}last updated {fmtDate(na.last_updated_at?.slice(0, 10))}
              {' — '}<Link to={`/needs-analysis/${na.id}/history`}>view history</Link>
            </div>
          ) : <p style={{ margin: 0, color: '#7d8fa1', fontSize: 13 }}>
                No analysis on file. One per company; every edit is kept.
              </p>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h2>Contacts</h2>
          <Link className="btn btn-sm" to={`/contacts/new?company=${id}`}>Add contact</Link>
        </div>
        <DataTable rows={contacts} empty={<Empty title="No contacts yet" />}
          columns={[
            { key: 'name', label: 'Name', sortValue: (r) => r.last_name,
              render: (r) => `${r.first_name} ${r.last_name}` },
            { key: 'role', label: 'Role', render: (r) => r.role?.name ?? '—' },
            { key: 'cell_phone', label: 'Cell',
              render: (r) => r.cell_phone ? <a className="mono" href={`tel:${r.cell_phone}`}>{r.cell_phone}</a> : '—' },
            { key: 'email', label: 'Email',
              render: (r) => r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : '—' },
            { key: 'a', label: '', sortable: false,
              render: (r) => <Link className="btn btn-sm" to={`/contacts/${r.id}/edit`}>Edit</Link> },
          ]} />
      </div>

      <div className="card">
        <div className="card-head"><h2>Recent activity</h2></div>
        <DataTable rows={acts} empty={<Empty title="No visits logged" />}
          columns={[
            { key: 'activity_date', label: 'Date', render: (r) => fmtDate(r.activity_date) },
            { key: 'activity_type', label: 'Activity' },
            { key: 'type_of_contact', label: 'Contact type' },
            { key: 'stage', label: 'Stage', sortable: false,
              render: (r) => r.stage?.short_label ? <Chip>{r.stage.short_label}</Chip> : '—' },
          ]} />
      </div>
    </>
  )
}
