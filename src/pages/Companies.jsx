import { useState, useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp, useQuery, fetchAll, save, territoryForCity } from '../lib/data'
import { Field, Text, Select, Area, DataTable, Banner, Empty, Loading, Chip, TerritoryChip, Modal } from '../components/ui'
import { fmtDate } from '../lib/format'
import { COMPANY_STATUSES } from '../lib/enums'

// Strip any existing "(formerly …)" suffix so repeated renames don't nest.
const baseName = (s) => (s ?? '').replace(/\s*\(formerly .*\)\s*$/i, '').trim()

const StatusChip = ({ status }) =>
  !status || status === 'active' ? null
    : <Chip kind={status === 'closed' ? 'bad' : ''}>{COMPANY_STATUSES[status] ?? status}</Chip>

const SEL = `*, category:categories(id,name), subcategory:subcategories(id,name)`

export function CompanyList() {
  const { lookups, facilityId, isAdmin } = useApp()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('open')   // open (hide closed) | closed | all
  const [sel, setSel] = useState(() => new Set())   // selected company ids (for merge)
  const [merging, setMerging] = useState(false)

  const { rows, loading, error, refresh } = useQuery(() => fetchAll(() => {
    let q = supabase.from('companies').select(SEL)
      .eq('active', true).is('merged_into_id', null).order('name').order('id')
    if (category) q = q.eq('category_id', category)
    if (status === 'open') q = q.neq('status', 'closed')
    else if (status === 'closed') q = q.eq('status', 'closed')
    if (search.trim()) {
      const s = `%${search.trim()}%`
      q = q.or(`name.ilike.${s},city.ilike.${s}`)
    }
    return q
  }), [search, category, status])

  // Territory for this account, derived from its city via the selected
  // campus's map — the same resolution the forms and database use.
  const terrName = (tid) => (lookups.territories ?? []).find((t) => t.id === tid)?.name
  const coTerr = (r) => terrName(territoryForCity(lookups.territoryCities, r.city))

  const toggleSel = (id) => setSel((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const selRows = rows.filter((r) => sel.has(r.id))

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
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="open">Open (hide closed)</option>
          <option value="closed">Closed only</option>
          <option value="all">All statuses</option>
        </select>
        <div className="spacer" />
        <span className="mono" style={{ color: '#7d8fa1', fontSize: 12 }}>
          {loading ? '' : `${rows.length} shown`}
        </span>
      </div>

      {isAdmin && sel.size > 0 && (
        <Banner kind="info">
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {sel.size} selected.
            <button className="btn btn-sm btn-primary" type="button"
                    disabled={sel.size !== 2} onClick={() => setMerging(true)}>
              Merge 2 companies
            </button>
            {sel.size !== 2 && <span style={{ fontSize: 12 }}>Select exactly two to merge.</span>}
            <button className="btn btn-sm" type="button" onClick={() => setSel(new Set())}>Clear</button>
          </span>
        </Banner>
      )}

      <div className="card">
        <DataTable rows={rows} loading={loading} error={error} territoryOf={coTerr}
          empty={<Empty title="No companies yet"
                        body="Add your first account, or import from the old sites."
                        action={<Link className="btn btn-primary" to="/companies/new">Add company</Link>} />}
          columns={[
            ...(isAdmin ? [{ key: 'sel', label: '', sortable: false, render: (r) => (
              <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)}
                     aria-label={`Select ${r.name}`} />) }] : []),
            { key: 'name', label: 'Company',
              render: (r) => (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Link to={`/companies/${r.id}`}>{r.name}</Link>
                  <StatusChip status={r.status} />
                </span>
              ) },
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

      {merging && selRows.length === 2 && (
        <MergeCompanies a={selRows[0]} b={selRows[1]}
          onClose={() => setMerging(false)}
          onDone={() => { setMerging(false); setSel(new Set()); refresh() }} />
      )}
    </>
  )
}

// Pick which of two companies to keep; the other is folded into it (its
// activities, referrals, contacts and campus links move over) and hidden.
function MergeCompanies({ a, b, onClose, onDone }) {
  const [winner, setWinner] = useState(a.id)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const loser = winner === a.id ? b : a
  const keep = winner === a.id ? a : b
  const label = (c) => `${c.name}${c.city ? ` · ${c.city}` : ''}`

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('merge_companies', { p_loser: loser.id, p_winner: winner })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      onDone()
    } catch (e2) {
      const msg = /not found|Function not found|404/i.test(e2.message ?? '')
        ? 'The merge function is not deployed yet. Deploy migration 014 (merge_companies), then try again.'
        : e2.message
      setErr(msg); setBusy(false)
    }
  }

  return (
    <Modal title="Merge companies" onClose={onClose}>
      <form onSubmit={submit}>
        <Banner kind="error">{err}</Banner>
        <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13 }}>
          Choose the company to <b>keep</b>. The other is merged into it — its
          activities, referrals, contacts and campus links move over, and it is
          hidden from the list. This can’t be undone.
        </p>
        <div className="dupe-list">
          {[a, b].map((c) => (
            <label key={c.id} className="dupe" style={{ cursor: 'pointer' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="radio" name="winner" checked={winner === c.id}
                       onChange={() => setWinner(c.id)} />
                <span className="dupe-main">
                  <span className="dupe-name caps">{c.name}</span>
                  <span className="dupe-sub caps">{[c.category?.name, c.city].filter(Boolean).join(' · ') || '—'}</span>
                </span>
              </span>
              <Chip kind={winner === c.id ? 'ok' : ''}>{winner === c.id ? 'Keep' : 'Merge in'}</Chip>
            </label>
          ))}
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          Keeping <b className="caps">{label(keep)}</b>; merging in <b className="caps">{label(loser)}</b>.
        </p>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Merging…' : 'Merge'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
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
  const [dupes, setDupes] = useState(null)   // possible duplicates awaiting confirmation

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

  const doSave = async () => {
    setBusy(true); setError(null); setDupes(null)
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

  const submit = async (e) => {
    e.preventDefault()
    if (!v.name?.trim()) return setError('Company name is required.')
    // Warn about likely duplicates before creating a brand-new company. It's a
    // soft check: same address can be legitimate (many providers, one hospital),
    // so the rep confirms. If the RPC isn't available, saving just proceeds.
    if (!id) {
      setBusy(true); setError(null)
      const { data: matches } = await supabase.rpc('find_company_duplicates',
        { p_name: v.name.trim(), p_address: v.address_line1, p_city: v.city })
      setBusy(false)
      if (matches && matches.length) { setDupes(matches); return }
    }
    doSave()
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

      {dupes && (
        <Modal title="Possible duplicate" onClose={() => setDupes(null)}>
          <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13 }}>
            This looks like it may already exist. Several providers can share one
            address (a hospital, a clinic), so this is only a heads-up — but please
            check these first:
          </p>
          <div className="dupe-list">
            {dupes.map((d) => (
              <a key={d.id} className="dupe" href={`/companies/${d.id}`} target="_blank" rel="noreferrer">
                <div className="dupe-main">
                  <span className="dupe-name caps">{d.name}</span>
                  <span className="dupe-sub caps">
                    {[d.address_line1, d.city].filter(Boolean).join(' · ') || 'no address on file'}
                  </span>
                </div>
                {d.same_address
                  ? <Chip kind="bad">Same address</Chip>
                  : <Chip>{Math.round((d.score ?? 0) * 100)}% name match</Chip>}
              </a>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={doSave} disabled={busy}>
              {busy ? 'Saving…' : 'Add anyway'}
            </button>
            <button type="button" className="btn" onClick={() => setDupes(null)}>Go back</button>
          </div>
        </Modal>
      )}
    </form>
  )
}

export function CompanyDetail() {
  const { id } = useParams()
  const { lookups } = useApp()
  const { rows: [co] = [], loading, refresh } = useQuery(
    () => supabase.from('companies').select(SEL).eq('id', id), [id])
  const [renaming, setRenaming] = useState(false)
  const [statusErr, setStatusErr] = useState(null)
  const [statusBusy, setStatusBusy] = useState(false)
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

  const applyStatus = async (patch) => {
    setStatusBusy(true); setStatusErr(null)
    const { error } = await supabase.from('companies').update(patch).eq('id', id)
    setStatusBusy(false)
    if (error) { setStatusErr(error.message); return false }
    refresh()
    return true
  }

  const markClosed = () => {
    if (!confirm(`Mark ${baseName(co.name)} as closed? It stays on file for history but is hidden from the default company list.`)) return
    applyStatus({ status: 'closed' })
  }
  const reopen = () => applyStatus({ status: co.former_name ? 'name_change' : 'active' })

  if (loading) return <Loading rows={8} />
  if (!co) return <Empty title="Company not found" />

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="caps">{co.name}</h1>
          <p className="caps">{[co.category?.name, co.subcategory?.name, co.city, co.state]
                .filter(Boolean).join(' · ')}</p>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {coTerr && <TerritoryChip name={coTerr} />}
            <StatusChip status={co.status} />
          </div>
        </div>
        <div className="row-actions">
          <Link className="btn" to={`/companies/${id}/edit`}>Edit</Link>
          <button className="btn" type="button" onClick={() => setRenaming(true)}>Name change</button>
          {co.status === 'closed'
            ? <button className="btn" type="button" onClick={reopen} disabled={statusBusy}>Reopen</button>
            : <button className="btn btn-danger" type="button" onClick={markClosed} disabled={statusBusy}>Mark closed</button>}
          <Link className="btn btn-primary" to={`/activities/new?company=${id}`}>Log activity</Link>
        </div>
      </div>

      {statusErr && <Banner kind="error">{statusErr}</Banner>}

      {renaming && (
        <NameChange co={co} busy={statusBusy}
          onClose={() => setRenaming(false)}
          onSave={async (finalName, former) => {
            const ok = await applyStatus({ name: finalName, former_name: former, status: 'name_change' })
            if (ok) setRenaming(false)
          }} />
      )}

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

// Rename a company in place, preserving the old name as "(formerly …)". The
// account row is shared, so everything that references it follows the rename.
function NameChange({ co, busy, onClose, onSave }) {
  const old = baseName(co.name)
  const [name, setName] = useState('')
  const [err, setErr] = useState(null)
  const preview = name.trim() ? `${name.trim()} (formerly ${old})` : ''

  const submit = (e) => {
    e.preventDefault()
    const next = name.trim()
    if (!next) return setErr('Enter the new company name.')
    if (next.toLowerCase() === old.toLowerCase()) return setErr('That is already the current name.')
    onSave(`${next} (formerly ${old})`, old)
  }

  return (
    <Modal title="Name change" onClose={onClose}>
      <form onSubmit={submit}>
        <Banner kind="error">{err}</Banner>
        <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13 }}>
          Current name: <b className="caps">{old}</b>. Enter the new name — the old one
          is kept in parentheses so the account stays recognizable.
        </p>
        <Field label="New company name" span={12} required>
          <Text value={name} onChange={setName} autoFocus />
        </Field>
        {preview && (
          <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>
            Will display as: <b className="caps">{preview}</b>
          </p>
        )}
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save name change'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  )
}
