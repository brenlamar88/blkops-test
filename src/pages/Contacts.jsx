import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp, useQuery, save, remove } from '../lib/data'
import { Field, Text, Select, Area, DataTable, Banner, Empty, Loading } from '../components/ui'

const SEL = `*, role:contact_roles(id,name), company:companies(id,name),
  t1:character_traits!contacts_character_trait_1_id_fkey(name),
  t2:character_traits!contacts_character_trait_2_id_fkey(name)`

export function ContactList() {
  const { lookups } = useApp()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')

  const { rows, loading, error, refresh } = useQuery(() => {
    let q = supabase.from('contacts').select(SEL).eq('active', true).order('last_name')
    if (role) q = q.eq('role_id', role)
    if (search.trim()) {
      const s = `%${search.trim()}%`
      q = q.or(`first_name.ilike.${s},last_name.ilike.${s},email.ilike.${s}`)
    }
    return q.limit(300)
  }, [search, role])

  const del = async (r) => {
    if (!confirm(`Remove ${r.first_name} ${r.last_name}?`)) return
    try { await remove('contacts', r.id); refresh() } catch (e) { alert(e.message) }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Contacts</h1>
          <p>People at your accounts. Character traits carry over from the old call
             sheets so you know who you are walking in to see.</p>
        </div>
        <Link className="btn btn-primary" to="/contacts/new">Add contact</Link>
      </div>

      <div className="toolbar">
        <input placeholder="Search name or email…" value={search}
               onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 230 }} />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {(lookups.contactRoles ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      <div className="card">
        <DataTable rows={rows} loading={loading} error={error}
          empty={<Empty title="No contacts yet"
                        action={<Link className="btn btn-primary" to="/contacts/new">Add contact</Link>} />}
          columns={[
            { key: 'name', label: 'Name', sortValue: (r) => r.last_name,
              render: (r) => `${r.first_name} ${r.last_name}` },
            { key: 'company', label: 'Company', sortValue: (r) => r.company?.name,
              render: (r) => r.company ? <Link to={`/companies/${r.company.id}`}>{r.company.name}</Link> : '—' },
            { key: 'role', label: 'Role', render: (r) => r.role?.name ?? '—' },
            { key: 'traits', label: 'Traits', sortable: false,
              render: (r) => [r.t1?.name, r.t2?.name].filter(Boolean).join(' / ') || '—' },
            { key: 'cell_phone', label: 'Cell',
              render: (r) => r.cell_phone ? <a className="mono" href={`tel:${r.cell_phone}`}>{r.cell_phone}</a> : '—' },
            { key: 'a', label: '', sortable: false, render: (r) => (
                <div className="row-actions">
                  <Link className="btn btn-sm" to={`/contacts/${r.id}/edit`}>Edit</Link>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => del(r)}>Delete</button>
                </div>) },
          ]} />
      </div>
    </>
  )
}

const BLANK = { company_id: null, first_name: '', last_name: '', role_id: null,
  cell_phone: null, office_phone: null, email: null,
  character_trait_1_id: null, character_trait_2_id: null, notes: null }

export function ContactForm() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const { lookups, profile } = useApp()
  const [v, setV] = useState({ ...BLANK, company_id: params.get('company') })
  const [loaded, setLoaded] = useState(!id)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const { rows: companies } = useQuery(
    () => supabase.from('companies').select('id,name').eq('active', true)
      .is('merged_into_id', null).order('name').limit(1000), [])

  useQuery(async () => {
    if (!id) return null
    const r = await supabase.from('contacts').select('*').eq('id', id).single()
    if (r.data) { setV(r.data); setLoaded(true) }
    return r
  }, [id])

  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val }))

  const submit = async (e) => {
    e.preventDefault()
    if (!v.company_id) return setError('Pick the company this person works for.')
    if (!v.first_name?.trim() || !v.last_name?.trim())
      return setError('First and last name are both required.')
    setBusy(true); setError(null)
    try {
      const payload = { ...v, created_by: v.created_by ?? profile.id }
      delete payload.created_at; delete payload.updated_at
      await save('contacts', id, payload)
      nav(`/companies/${v.company_id}`)
    } catch (err) { setError(err.message); setBusy(false) }
  }

  if (!loaded) return <Loading rows={6} />

  return (
    <form onSubmit={submit}>
      <div className="page-head"><div><h1>{id ? 'Edit contact' : 'Add contact'}</h1></div></div>
      <div className="card"><div className="card-body">
        <Banner kind="error">{error}</Banner>
        <div className="section-label" style={{ marginTop: 0 }}>Who and where</div>
        <div className="grid">
          <Field label="Company" span={8} required>
            <Select value={v.company_id} onChange={set('company_id')} options={companies} />
          </Field>
          <Field label="Role" span={4}>
            <Select value={v.role_id} onChange={set('role_id')} options={lookups.contactRoles ?? []} />
          </Field>
          <Field label="First name" span={6} required><Text value={v.first_name} onChange={set('first_name')} /></Field>
          <Field label="Last name" span={6} required><Text value={v.last_name} onChange={set('last_name')} /></Field>
        </div>
        <div className="section-label">Reaching them</div>
        <div className="grid">
          <Field label="Cell phone" span={4}><Text value={v.cell_phone} onChange={set('cell_phone')} type="tel" /></Field>
          <Field label="Office phone" span={4}><Text value={v.office_phone} onChange={set('office_phone')} type="tel" /></Field>
          <Field label="Email" span={4}><Text value={v.email} onChange={set('email')} type="email" /></Field>
        </div>
        <div className="section-label">Approach</div>
        <div className="grid">
          <Field label="Character trait 1" span={4}>
            <Select value={v.character_trait_1_id} onChange={set('character_trait_1_id')}
                    options={lookups.characterTraits ?? []} />
          </Field>
          <Field label="Character trait 2" span={4}>
            <Select value={v.character_trait_2_id} onChange={set('character_trait_2_id')}
                    options={lookups.characterTraits ?? []} />
          </Field>
          <Field label="Notes" span={12}><Area value={v.notes} onChange={set('notes')} /></Field>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save contact'}</button>
          <button type="button" className="btn" onClick={() => nav(-1)}>Cancel</button>
        </div>
      </div></div>
    </form>
  )
}
