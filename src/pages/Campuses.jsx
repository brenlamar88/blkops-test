import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp, useQuery } from '../lib/data'
import { Field, Text, Banner, Empty, Loading, Modal, Chip } from '../components/ui'

/* ------------------------------------------------------------------
   Campuses — add and manage the facilities in the organization.

   Inserting a facility is gated by RLS to org admins (is_org_admin). A
   DB trigger then seeds the campus's four territories and makes the
   creator an admin of it, so it shows up in the switcher (reloadMemberships)
   and is ready to work immediately.
------------------------------------------------------------------ */

const slugify = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40)

export default function Campuses() {
  const { memberships, reloadMemberships } = useApp()
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null) // facility being renamed, or 'new'

  const isOrgAdmin = memberships.some((m) => m.role === 'admin')
  const myFacIds = useMemo(() => new Set(memberships.map((m) => m.facility_id)), [memberships])

  const orgQ = useQuery(() => supabase.from('organizations').select('id, name').limit(1), [])
  const org = orgQ.rows[0]

  const facQ = useQuery(() => org
    ? supabase.from('facilities').select('id, name, slug, active')
        .eq('organization_id', org.id).order('name')
    : null, [org?.id])

  const toggleActive = async (f) => {
    setError(null)
    try {
      const { error } = await supabase.from('facilities')
        .update({ active: !f.active }).eq('id', f.id)
      if (error) throw error
      facQ.refresh()
    } catch (e) { setError(e.message) }
  }

  const saved = async () => {
    setEditing(null)
    facQ.refresh()
    await reloadMemberships()   // a newly created campus makes you its admin
  }

  if (orgQ.loading) return <Loading rows={6} />

  if (!isOrgAdmin) {
    return (
      <>
        <div className="page-head"><div><h1>Campuses</h1></div></div>
        <Empty title="Admins only" body="You need the admin role to add or change campuses." />
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Campuses</h1>
          <p>The facilities in {org?.name ?? 'your organization'}. A new campus starts
             with the standard Red/White/Blue/Gold territories, and you become its admin.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>Add campus</button>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      <div className="card">
        {facQ.loading ? <Loading rows={6} /> : facQ.rows.length === 0 ? (
          <Empty title="No campuses yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Campus</th><th>Slug</th><th>Status</th><th>Yours</th><th></th></tr>
              </thead>
              <tbody>
                {facQ.rows.map((f) => (
                  <tr key={f.id}>
                    <td>{f.name}</td>
                    <td className="mono">{f.slug}</td>
                    <td>{f.active ? <Chip kind="ok">Active</Chip> : <Chip kind="bad">Inactive</Chip>}</td>
                    <td>{myFacIds.has(f.id) ? <Chip>Member</Chip> : '—'}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-sm" type="button"
                                onClick={() => setEditing(f)}>Rename</button>
                        <button className="btn btn-sm" type="button"
                                onClick={() => toggleActive(f)}>
                          {f.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && org && (
        <CampusForm org={org} facility={editing === 'new' ? null : editing}
                    existing={facQ.rows} onClose={() => setEditing(null)} onSaved={saved} />
      )}
    </>
  )
}

function CampusForm({ org, facility, existing, onClose, onSaved }) {
  const [name, setName] = useState(facility?.name ?? '')
  const [slug, setSlug] = useState(facility?.slug ?? '')
  const [autoSlug, setAutoSlug] = useState(!facility) // new campuses auto-derive the slug
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const effectiveSlug = autoSlug ? slugify(name) : slug

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return setErr('A campus name is required.')
    if (!effectiveSlug) return setErr('The slug came out blank — add letters or numbers to the name.')
    const clash = existing.find((f) => f.slug === effectiveSlug && f.id !== facility?.id)
    if (clash) return setErr(`The slug "${effectiveSlug}" is already used by ${clash.name}.`)
    setBusy(true); setErr(null)
    try {
      if (facility) {
        const { error } = await supabase.from('facilities')
          .update({ name: name.trim() }).eq('id', facility.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('facilities')
          .insert({ organization_id: org.id, name: name.trim(), slug: effectiveSlug })
        if (error) throw error
      }
      onSaved()
    } catch (e2) {
      const msg = /duplicate key|unique/i.test(e2.message ?? '')
        ? 'That name or slug is already taken.' : e2.message
      setErr(msg); setBusy(false)
    }
  }

  return (
    <Modal title={facility ? 'Rename campus' : 'Add campus'} onClose={onClose}>
      <form onSubmit={submit}>
        <Banner kind="error">{err}</Banner>
        <div className="grid">
          <Field label="Campus name" span={12} required>
            <Text value={name} onChange={setName} autoFocus />
          </Field>
          {!facility && (
            <Field label="Slug" span={12}
                   hint="A short id used in links, lowercase and no spaces.">
              <Text value={effectiveSlug}
                    onChange={(v) => { setAutoSlug(false); setSlug(slugify(v)) }} />
            </Field>
          )}
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : facility ? 'Save name' : 'Create campus'}
          </button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  )
}
