import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

/* ------------------------------------------------------------------
   Session, profile, and campus membership.

   Access is granted per campus. A signed-in user with no
   facility_members row sees an empty system — that is the security
   model working, so the UI says so plainly rather than showing blank
   tables and letting someone think it is broken.
------------------------------------------------------------------ */

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

const LAST_FACILITY = 'blkops.facility'

export function AppProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [memberships, setMemberships] = useState([])
  const [facilityId, setFacilityId] = useState(null)
  const [lookups, setLookups] = useState({})
  const [menuHidden, setMenuHidden] = useState(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) { setProfile(null); setMemberships([]); setLoading(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) return
    let dead = false
    ;(async () => {
      const [{ data: prof }, { data: mems }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
        supabase.from('facility_members')
          .select('facility_id, role, facility:facilities(id, name, slug)')
          .eq('user_id', session.user.id),
      ])
      if (dead) return
      setProfile(prof)
      const list = (mems ?? []).filter((m) => m.facility)
        .sort((a, b) => a.facility.name.localeCompare(b.facility.name))
      setMemberships(list)
      const remembered = localStorage.getItem(LAST_FACILITY)
      const pick = list.find((m) => m.facility_id === remembered) ?? list[0]
      setFacilityId(pick?.facility_id ?? null)
      // Which menu items this user has had hidden (RLS returns only their own).
      const { data: mv } = await supabase.from('user_menu_visibility')
        .select('menu_key').eq('user_id', session.user.id).eq('hidden', true)
      if (!dead) setMenuHidden(new Set((mv ?? []).map((r) => r.menu_key)))
      setLoading(false)
    })()
    return () => { dead = true }
  }, [session])

  const loadLookups = useCallback(async () => {
    if (!session) return
    const tables = {
      categories: 'categories', subcategories: 'subcategories',
      contactRoles: 'contact_roles', payerSources: 'payer_sources',
      characterTraits: 'character_traits', denialReasons: 'denial_reasons',
      prescreenLocations: 'prescreen_locations', practitionerTypes: 'practitioner_types',
      stages: 'service_cycle_stages',
    }
    const out = {}
    await Promise.all(Object.entries(tables).map(async ([k, t]) => {
      const q = supabase.from(t).select('*').eq('active', true)
      const { data } = await (
        t === 'service_cycle_stages' ? q.order('rank', { ascending: false })
        : (t === 'categories' || t === 'payer_sources') ? q.order('sort_order')
        : q.order('name'))
      out[k] = data ?? []
    }))
    out.territories = facilityId
      ? (await supabase.from('territories').select('*')
          .eq('facility_id', facilityId).eq('active', true).order('sort_order')).data ?? []
      : []
    // City → territory map for the current campus, so the activity and referral
    // forms can fill territory from the selected company's city (the database
    // does the same on write; this just shows it before the save).
    out.territoryCities = facilityId
      ? (await supabase.from('territory_cities').select('city, territory_id')
          .eq('facility_id', facilityId)).data ?? []
      : []
    out.users = (await supabase.from('profiles')
      .select('id, first_name, last_name, email').eq('active', true)).data ?? []
    setLookups(out)
  }, [session, facilityId])

  useEffect(() => { loadLookups() }, [loadLookups])

  const switchFacility = (id) => {
    setFacilityId(id)
    localStorage.setItem(LAST_FACILITY, id)
  }

  const current = memberships.find((m) => m.facility_id === facilityId)

  return (
    <Ctx.Provider value={{
      session, profile, memberships, facilityId,
      facility: current?.facility, role: current?.role,
      isManager: ['manager', 'admin'].includes(current?.role),
      isAdmin: current?.role === 'admin',
      lookups, menuHidden, loading, switchFacility, reloadLookups: loadLookups,
    }}>
      {children}
    </Ctx.Provider>
  )
}

/* ------------------------------------------------------------------
   One place for the load / error / empty lifecycle, so every screen
   fails the same way when the network is bad.
------------------------------------------------------------------ */

export function useQuery(build, deps = []) {
  const [state, setState] = useState({ rows: [], loading: true, error: null })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let dead = false
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.resolve(build())
      .then((res) => {
        if (dead || !res) return
        setState({ rows: res.data ?? [], loading: false, error: res.error?.message ?? null })
      })
      .catch((e) => { if (!dead) setState({ rows: [], loading: false, error: e.message }) })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { ...state, refresh: () => setTick((t) => t + 1) }
}

export async function save(table, id, values) {
  const q = supabase.from(table)
  const { data, error } = id
    ? await q.update(values).eq('id', id).select().single()
    : await q.insert(values).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function remove(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// Resolve a company city to its mapped territory for the current campus,
// matching case- and whitespace-insensitively like territory_for_city() in SQL.
export function territoryForCity(territoryCities, city) {
  const key = (city ?? '').trim().toLowerCase()
  if (!key) return null
  return (territoryCities ?? []).find((m) => (m.city ?? '').trim().toLowerCase() === key)
    ?.territory_id ?? null
}

export const today = () => new Date().toISOString().slice(0, 10)
export const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
