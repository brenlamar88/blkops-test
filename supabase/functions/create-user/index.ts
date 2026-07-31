// Create a new login. This runs on Supabase's servers, not in the browser,
// because minting a user requires the service_role key — which must never
// ship to the client. The caller's JWT is verified and checked for the admin
// role at the requested campus before anything is created.
//
// Deploy:  supabase functions deploy create-user --project-ref <ref>
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!jwt) return json({ error: 'Not signed in.' }, 401)

    const { data: caller, error: cErr } = await admin.auth.getUser(jwt)
    if (cErr || !caller?.user) return json({ error: 'Invalid session.' }, 401)

    const { email, password, first_name, last_name, facility_id, role } = await req.json()
    if (!email || !password || !facility_id)
      return json({ error: 'Email, password and facility_id are required.' }, 400)
    const roleVal = ['rep', 'manager', 'admin'].includes(role) ? role : 'rep'

    // The caller must be an admin at the campus they are assigning.
    const { data: mem } = await admin.from('facility_members').select('role')
      .eq('user_id', caller.user.id).eq('facility_id', facility_id).maybeSingle()
    if (mem?.role !== 'admin')
      return json({ error: 'You must be an admin at that campus to add users.' }, 403)

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { first_name, last_name },
    })
    if (createErr) return json({ error: createErr.message }, 400)

    // handle_new_user already inserted the profile; attach the membership.
    const { error: fmErr } = await admin.from('facility_members')
      .insert({ facility_id, user_id: created.user.id, role: roleVal })
    if (fmErr) return json({ error: fmErr.message }, 400)

    return json({ user_id: created.user.id })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
