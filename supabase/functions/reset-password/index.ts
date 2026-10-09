// Set another user's password. Like create-user, this runs on Supabase's
// servers because changing a password for someone else needs the service_role
// key. The caller's JWT is verified and they must be an admin at a campus the
// target user also belongs to — a facility admin can only reset passwords for
// people on the campuses they administer.
//
// `temporary` stamps user_metadata.must_change_password so the app forces a
// change at the user's next sign-in. Supabase has no native "expire password"
// flag, so this metadata bit is the mechanism.
//
// Deploy:  supabase functions deploy reset-password --project-ref <ref>
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

    const { user_id, password, temporary } = await req.json()
    if (!user_id || !password)
      return json({ error: 'user_id and password are required.' }, 400)
    if (String(password).length < 8)
      return json({ error: 'Use a password of at least 8 characters.' }, 400)

    // The caller and the target must share a campus the caller administers.
    const [{ data: callerFacs }, { data: targetFacs }] = await Promise.all([
      admin.from('facility_members').select('facility_id')
        .eq('user_id', caller.user.id).eq('role', 'admin'),
      admin.from('facility_members').select('facility_id').eq('user_id', user_id),
    ])
    const adminIds = new Set((callerFacs ?? []).map((r) => r.facility_id))
    const shared = (targetFacs ?? []).some((r) => adminIds.has(r.facility_id))
    if (!shared)
      return json({ error: 'You must be an admin at a campus this user belongs to.' }, 403)

    // Merge the flag into existing metadata so names etc. are preserved.
    const { data: target } = await admin.auth.admin.getUserById(user_id)
    const meta = { ...(target?.user?.user_metadata ?? {}) }
    if (temporary) meta.must_change_password = true
    else delete meta.must_change_password

    const { error: updErr } = await admin.auth.admin.updateUserById(user_id, {
      password, user_metadata: meta,
    })
    if (updErr) return json({ error: updErr.message }, 400)

    return json({ ok: true, temporary: !!temporary })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
