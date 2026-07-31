import { useState } from 'react'
import { useApp, save } from '../lib/data'
import { Modal, Field, Text, Select, Banner } from './ui'

/* Add a contact for the already-selected company without leaving the form.
   Used on the activity and referral forms — a contact always belongs to a
   company, so we only ever offer this once a company is chosen. On save the
   parent refreshes its contact list and selects the new person. */

const BLANK = { first_name: '', last_name: '', role_id: null, cell_phone: null, email: null }

export default function QuickAddContact({ companyId, onAdded }) {
  const { lookups } = useApp()
  const [open, setOpen] = useState(false)
  const [v, setV] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  if (!companyId) return null

  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val }))

  const submit = async (e) => {
    e.preventDefault()
    if (!v.first_name.trim() || !v.last_name.trim())
      return setErr('First and last name are both required.')
    setBusy(true); setErr(null)
    try {
      const row = await save('contacts', null, { ...v, company_id: companyId })
      onAdded?.(row)
      setV(BLANK); setOpen(false)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  return (
    <>
      <button type="button" className="btn btn-sm" style={{ marginTop: 6 }}
              onClick={() => { setErr(null); setV(BLANK); setOpen(true) }}>
        + Add contact
      </button>
      {open && (
        <Modal title="Add contact" onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <Banner kind="error">{err}</Banner>
            <div className="grid">
              <Field label="First name" span={6} required>
                <Text value={v.first_name} onChange={set('first_name')} autoFocus />
              </Field>
              <Field label="Last name" span={6} required>
                <Text value={v.last_name} onChange={set('last_name')} />
              </Field>
              <Field label="Role" span={12}>
                <Select value={v.role_id} onChange={set('role_id')}
                        options={lookups.contactRoles ?? []} />
              </Field>
              <Field label="Cell phone" span={6}>
                <Text value={v.cell_phone} onChange={set('cell_phone')} type="tel" />
              </Field>
              <Field label="Email" span={6}>
                <Text value={v.email} onChange={set('email')} type="email" />
              </Field>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save contact'}
              </button>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
