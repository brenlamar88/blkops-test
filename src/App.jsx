import { useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { AppProvider, useApp } from './lib/data'
import { Field, Text, Banner, Empty } from './components/ui'
import { personName } from './lib/format'

import Dashboard from './pages/Dashboard'
import { CompanyList, CompanyForm, CompanyDetail } from './pages/Companies'
import { ContactList, ContactForm } from './pages/Contacts'
import { ActivityList, ActivityForm } from './pages/Activities'
import { ReferralList, ReferralForm } from './pages/Referrals'
import { NaList, NaForm, NaHistory } from './pages/NeedsAnalysis'
import ActivityDashboard from './pages/ActivityDashboard'
import TerritoryMap from './pages/TerritoryMap'
import Reports from './pages/Reports'

function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>Black Ops</h1>
        <p>Referral and territory management.</p>
        <Banner kind="error">{error}</Banner>
        <Field label="Email" span={12}>
          <Text value={email} onChange={setEmail} type="email" autoComplete="username" required />
        </Field>
        <Field label="Password" span={12}>
          <Text value={password} onChange={setPassword} type="password"
                autoComplete="current-password" required />
        </Field>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

const NAV = [
  ['Daily work', [['/', 'Dashboard'], ['/activities', 'Activities'], ['/referrals', 'Referrals']]],
  ['Accounts', [['/companies', 'Companies'], ['/contacts', 'Contacts'],
                ['/needs-analysis', 'Needs analysis']]],
  ['Reporting', [['/activity-dashboard', 'Activity dashboard'], ['/reports', 'Reports']]],
]

// Shown only to managers and admins.
const ADMIN_NAV = ['Admin', [['/territory-map', 'Territory map']]]

function Shell({ children }) {
  const { profile, memberships, facilityId, facility, role, isManager, switchFacility } = useApp()
  const nav = isManager ? [...NAV, ADMIN_NAV] : NAV
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <b>BLACK OPS</b>
          <span>Freedom Behavioral Health</span>
        </div>

        <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.09)' }}>
          <label style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.09em',
                          color: '#64788c', fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Campus
          </label>
          <select value={facilityId ?? ''} onChange={(e) => switchFacility(e.target.value)}>
            {memberships.map((m) => (
              <option key={m.facility_id} value={m.facility_id}>{m.facility.name}</option>
            ))}
          </select>
        </div>

        <nav className="nav">
          {nav.map(([group, items]) => (
            <div className="nav-group" key={group}>
              <p>{group}</p>
              {items.map(([to, label]) => (
                <NavLink key={to} to={to} end={to === '/'}
                         className={({ isActive }) => (isActive ? 'active' : '')}>
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="who">{personName(profile)}</div>
          <div style={{ color: '#64788c', fontSize: 11 }}>
            {role}{facility ? ` · ${facility.name}` : ''}
          </div>
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  )
}

function NoCampus() {
  const { profile } = useApp()
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 460 }}>
        <h1>No campus assigned</h1>
        <p>
          You are signed in as {profile?.email}, but your account is not assigned to a
          campus yet — so there is nothing for you to see. An administrator needs to add
          you before you can log activity.
        </p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  )
}

function Gate() {
  const { session, loading, memberships } = useApp()
  if (loading) return <div className="auth-wrap" />
  if (!session) return <SignIn />
  if (!memberships.length) return <NoCampus />
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/companies" element={<CompanyList />} />
          <Route path="/companies/new" element={<CompanyForm />} />
          <Route path="/companies/:id" element={<CompanyDetail />} />
          <Route path="/companies/:id/edit" element={<CompanyForm />} />
          <Route path="/contacts" element={<ContactList />} />
          <Route path="/contacts/new" element={<ContactForm />} />
          <Route path="/contacts/:id/edit" element={<ContactForm />} />
          <Route path="/activities" element={<ActivityList />} />
          <Route path="/activities/new" element={<ActivityForm />} />
          <Route path="/activities/:id/edit" element={<ActivityForm />} />
          <Route path="/referrals" element={<ReferralList />} />
          <Route path="/referrals/new" element={<ReferralForm />} />
          <Route path="/referrals/:id/edit" element={<ReferralForm />} />
          <Route path="/needs-analysis" element={<NaList />} />
          <Route path="/needs-analysis/company/:companyId" element={<NaForm />} />
          <Route path="/needs-analysis/:id/history" element={<NaHistory />} />
          <Route path="/activity-dashboard" element={<ActivityDashboard />} />
          <Route path="/territory-map" element={<TerritoryMap />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  )
}

export default function App() {
  return <AppProvider><Gate /></AppProvider>
}
