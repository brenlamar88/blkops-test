import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp, useQuery } from '../lib/data'
import { Field, Text, Select, Check, Banner, Empty, Loading, Modal, Chip } from '../components/ui'
import { personName } from '../lib/format'
import { HIDEABLE_ITEMS } from '../lib/menu'

/* ------------------------------------------------------------------
   Users — assign campuses and roles, and control each person's menu.

   A user belongs to many campuses through many facility_members rows, with
   the role on each row, so this screen just adds/removes those rows. Writes
   are gated by the existing is_admin_at(facility_id) policy: a facility admin
   only ever sees and edits users on the campuses they administer.

   Creating a brand-new login needs the Supabase service key, which can't ship
   in the browser — that call goes to the create-user Edge Function.
------------------------------------------------------------------ */

const ROLES = ['rep', 'manager', 'admin']

export default function Users() {
  const { memberships } = useApp()
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(false)

  // Campuses where the current user is an admin — the only ones they manage.
  const adminFacs = useMemo(
    () => memberships.filter((m) => m.role === 'admin').map((m) => m.facility).filter(Boolean),
    [memberships])
  const adminIds = adminFacs.map((f) => f.id)

  const membersQ = useQuery(() => adminIds.length
    ? supabase.from('facility_members')
        .select(`user_id, facility_id, role,
                 profile:profiles(id, first_name, last_name, email, active),
                 facility:facilities(id, name)`)
        .in('facility_id', adminIds)
    : null, [adminIds.join(',')])

  const userIds = [...new Set(membersQ.rows.map((r) => r.user_id))]
  const menuQ = useQuery(() => userIds.length
    ? supabase.from('user_menu_visibility').select('user_id, menu_key')
        .eq('hidden', true).in('user_id', userIds)
    : null, [userIds.join(',')])

  const users = useMemo(() => {
    const by = new Map()
    for (const r of membersQ.rows) {
      const u = by.get(r.user_id) ?? { ...r.profile, memberships: [] }
      u.memberships.push({ facility_id: r.facility_id, name: r.facility?.name, role: r.role })
      by.set(r.user_id, u)
    }
    return [...by.values()].sort((a, b) => (a.last_name ?? '').localeCompare(b.last_name ?? ''))
  }, [membersQ.rows])

  const hiddenByUser = useMemo(() => {
    const m = {}
    for (const r of menuQ.rows) (m[r.user_id] ??= new Set()).add(r.menu_key)
    return m
  }, [menuQ.rows])

  const guard = async (fn) => {
    setError(null)
    try { await fn(); membersQ.refresh(); menuQ.refresh() }
    catch (e) { setError(e.message) }
  }

  const setRole = (uid, fid, role) => guard(() =>
    supabase.from('facility_members').update({ role }).eq('user_id', uid).eq('facility_id', fid)
      .then(({ error }) => { if (error) throw error }))
  const addCampus = (uid, fid) => guard(() =>
    supabase.from('facility_members').insert({ user_id: uid, facility_id: fid, role: 'rep' })
      .then(({ error }) => { if (error) throw error }))
  const removeCampus = (uid, fid, name) => {
    if (!confirm(`Remove this user from ${name}?`)) return
    guard(() => supabase.from('facility_members').delete().eq('user_id', uid).eq('facility_id', fid)
      .then(({ error }) => { if (error) throw error }))
  }
  const toggleMenu = (uid, key, visible) => guard(() => (visible
    ? supabase.from('user_menu_visibility').delete().eq('user_id', uid).eq('menu_key', key)
    : supabase.from('user_menu_visibility').upsert(
        { user_id: uid, menu_key: key, hidden: true }, { onConflict: 'user_id,menu_key' })
    ).then(({ error }) => { if (error) throw error }))

  if (!adminIds.length) {
    return (
      <>
        <div className="page-head"><div><h1>Users</h1></div></div>
        <Empty title="Admins only"
               body="You need the admin role at a campus to manage its users." />
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>Assign campuses and roles, and choose what each person sees in the menu.
             You manage users on the {adminFacs.length === 1 ? 'campus' : 'campuses'} you
             administer{adminFacs.length ? `: ${adminFacs.map((f) => f.name).join(', ')}` : ''}.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>Add user</button>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      {membersQ.loading ? <Loading rows={6} /> : users.length === 0 ? (
        <Empty title="No users yet" body="Add the first user for your campus." />
      ) : users.map((u) => (
        <UserCard key={u.id} user={u} adminFacs={adminFacs}
                  hidden={hiddenByUser[u.id] ?? new Set()}
                  onRole={setRole} onAdd={addCampus} onRemove={removeCampus} onMenu={toggleMenu} />
      ))}

      {adding && (
        <AddUser adminFacs={adminFacs} onClose={() => setAdding(false)}
                 onDone={() => { setAdding(false); membersQ.refresh() }} />
      )}
    </>
  )
}

function UserCard({ user, adminFacs, hidden, onRole, onAdd, onRemove, onMenu }) {
  const [showMenu, setShowMenu] = useState(false)
  const has = new Set(user.memberships.map((m) => m.facility_id))
  const addable = adminFacs.filter((f) => !has.has(f.id))

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className="caps">{personName(user)}</h2>
            <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>{user.email}</div>
          </div>
          {!user.active && <Chip kind="bad">Inactive</Chip>}
        </div>

        <div className="section-label">Campuses & roles</div>
        <div className="grid">
          {user.memberships.map((m) => (
            <div className="f-6" key={m.facility_id}
                 style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="caps" style={{ flex: 1, fontSize: 13 }}>{m.name}</span>
              <Select value={m.role} onChange={(v) => onRole(user.id, m.facility_id, v)}
                      placeholder="" options={ROLES} />
              <button className="btn btn-sm btn-danger" type="button"
                      onClick={() => onRemove(user.id, m.facility_id, m.name)}>Remove</button>
            </div>
          ))}
        </div>

        {addable.length > 0 && (
          <div style={{ marginTop: 10, maxWidth: 320 }}>
            <Select value="" placeholder="+ Add a campus…"
                    onChange={(fid) => fid && onAdd(user.id, fid)}
                    options={addable.map((f) => [f.id, f.name])} />
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <button className="btn btn-sm" type="button" onClick={() => setShowMenu((s) => !s)}>
            {showMenu ? 'Hide menu settings' : 'Menu settings'}
          </button>
        </div>

        {showMenu && (
          <>
            <div className="section-label">Menu — unchecked items are hidden for this user</div>
            <div className="grid">
              {HIDEABLE_ITEMS.map((item) => (
                <div className="f-4" key={item.key}>
                  <Check label={`${item.label}`} value={!hidden.has(item.key)}
                         onChange={(visible) => onMenu(user.id, item.key, visible)} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function AddUser({ adminFacs, onClose, onDone }) {
  const [v, setV] = useState({
    email: '', password: '', first_name: '', last_name: '',
    facility_id: adminFacs[0]?.id ?? '', role: 'rep',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val }))

  const submit = async (e) => {
    e.preventDefault()
    if (!v.email.trim() || !v.password || !v.facility_id)
      return setErr('Email, password and a campus are required.')
    if (v.password.length < 8) return setErr('Use a password of at least 8 characters.')
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.functions.invoke('create-user', { body: v })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      onDone()
    } catch (e2) {
      // The Edge Function may not be deployed yet — say so plainly.
      const msg = /Failed to send|not found|Function not found|404/i.test(e2.message ?? '')
        ? 'The create-user function is not deployed yet. Deploy supabase/functions/create-user, then try again.'
        : e2.message
      setErr(msg); setBusy(false)
    }
  }

  return (
    <Modal title="Add user" onClose={onClose}>
      <form onSubmit={submit}>
        <Banner kind="error">{err}</Banner>
        <div className="grid">
          <Field label="First name" span={6}><Text value={v.first_name} onChange={set('first_name')} autoFocus /></Field>
          <Field label="Last name" span={6}><Text value={v.last_name} onChange={set('last_name')} /></Field>
          <Field label="Email" span={12} required><Text value={v.email} onChange={set('email')} type="email" /></Field>
          <Field label="Temporary password" span={12} required
                 hint="At least 8 characters. The user can change it after signing in.">
            <Text value={v.password} onChange={set('password')} type="text" />
          </Field>
          <Field label="Campus" span={6} required>
            <Select value={v.facility_id} onChange={set('facility_id')} placeholder=""
                    options={adminFacs.map((f) => [f.id, f.name])} />
          </Field>
          <Field label="Role" span={6}>
            <Select value={v.role} onChange={set('role')} placeholder="" options={ROLES} />
          </Field>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  )
}
