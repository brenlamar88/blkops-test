import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp, useQuery, daysAgo } from '../lib/data'
import { DataTable, Empty, Chip } from '../components/ui'
import { fmtDate, personName } from '../lib/format'

const Kpi = ({ label, value, loading }) => (
  <div className="kpi"><span className="l">{label}</span>
    <span className="n">{loading ? '—' : value}</span></div>
)

export default function Dashboard() {
  const { profile, facility, facilityId } = useApp()

  // Count tiles use exact server-side counts (head:true fetches no rows), so
  // they are never capped by the row limit.
  const { count: companyCount, loading: lc } = useQuery(
    () => supabase.from('companies').select('id', { count: 'exact', head: true })
      .eq('active', true).is('merged_into_id', null), [])
  const { count: contactCount, loading: lk } = useQuery(
    () => supabase.from('contacts').select('id', { count: 'exact', head: true })
      .eq('active', true), [])
  const { count: naCount, loading: ln } = useQuery(
    () => supabase.from('needs_analysis').select('id', { count: 'exact', head: true }), [])
  const { count: actWeekCount, loading: law } = useQuery(
    () => facilityId ? supabase.from('daily_activities').select('id', { count: 'exact', head: true })
      .eq('facility_id', facilityId).gte('activity_date', daysAgo(7)) : null, [facilityId])
  const { count: pendingCount, loading: lrc } = useQuery(
    () => facilityId ? supabase.from('referrals').select('id', { count: 'exact', head: true })
      .eq('facility_id', facilityId)
      .or('admission_status.is.null,admission_status.eq.Pending') : null, [facilityId])

  // The two feeds below are previews, so a small limit is intentional.
  const { rows: acts, loading: la } = useQuery(
    () => facilityId ? supabase.from('daily_activities')
      .select('*, company:companies(id,name), user:profiles(first_name,last_name)')
      .eq('facility_id', facilityId).gte('activity_date', daysAgo(7))
      .order('activity_date', { ascending: false }).limit(12) : null, [facilityId])
  const { rows: pending, loading: lr } = useQuery(
    () => facilityId ? supabase.from('referrals')
      .select('*, company:companies(id,name)')
      .eq('facility_id', facilityId)
      .or('admission_status.is.null,admission_status.eq.Pending')
      .order('referral_date', { ascending: false }).limit(10) : null, [facilityId])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'},
            {' '}{profile?.first_name ?? 'there'}</h1>
          <p>{facility?.name ?? 'No campus'} — your day at a glance.</p>
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 16 }}>
        <Kpi label="Companies" value={companyCount ?? 0} loading={lc} />
        <Kpi label="Contacts" value={contactCount ?? 0} loading={lk} />
        <Kpi label="Needs analyses" value={naCount ?? 0} loading={ln} />
        <Kpi label="Activity, 7 days" value={actWeekCount ?? 0} loading={law} />
        <Kpi label="Referrals pending" value={pendingCount ?? 0} loading={lrc} />
      </div>

      <div className="card" style={{ marginBottom: 14 }}><div className="card-body">
        <div className="section-label" style={{ marginTop: 0 }}>Quick add</div>
        <div className="quick">
          <Link className="btn btn-primary" to="/activities/new">Log activity</Link>
          <Link className="btn" to="/referrals/new">Log referral</Link>
          <Link className="btn" to="/companies/new">Add company</Link>
          <Link className="btn" to="/contacts/new">Add contact</Link>
          <Link className="btn" to="/reports">Reports</Link>
        </div>
      </div></div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h2>Activity, last 7 days</h2>
          <Link className="btn btn-sm" to="/activities">See all</Link>
        </div>
        <DataTable rows={acts} loading={la}
          empty={<Empty title="Quiet week so far"
                        action={<Link className="btn btn-primary" to="/activities/new">Log activity</Link>} />}
          columns={[
            { key: 'activity_date', label: 'Date', render: (r) => fmtDate(r.activity_date) },
            { key: 'company', label: 'Company', sortValue: (r) => r.company?.name,
              render: (r) => r.company ? <Link to={`/companies/${r.company.id}`}>{r.company.name}</Link> : '—' },
            { key: 'activity_type', label: 'Activity' },
            { key: 'user', label: 'Rep', render: (r) => personName(r.user) },
          ]} />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Referrals awaiting an outcome</h2>
          <Link className="btn btn-sm" to="/referrals">See all</Link>
        </div>
        <DataTable rows={pending} loading={lr}
          empty={<Empty title="Nothing pending"
                        body="Every referral has an admit or denial recorded." />}
          columns={[
            { key: 'referral_date', label: 'Date', render: (r) => fmtDate(r.referral_date) },
            { key: 'patient', label: 'Patient', sortable: false,
              render: (r) => <span className="mono">
                {`${r.patient_first_name ?? '?'} ${r.patient_last_initial ?? '?'}.`}</span> },
            { key: 'company', label: 'Referred by', render: (r) => r.company?.name ?? '—' },
            { key: 's', label: 'Status', sortable: false, render: () => <Chip>Pending</Chip> },
            { key: 'a', label: '', sortable: false,
              render: (r) => <Link className="btn btn-sm" to={`/referrals/${r.id}/edit`}>Record outcome</Link> },
          ]} />
      </div>
    </>
  )
}
