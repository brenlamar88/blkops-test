import { createClient } from '@supabase/supabase-js'

// These two values are public by design — they ship in the browser bundle
// either way. The anon key grants nothing on its own: every table is behind
// row level security, so an unauthenticated request returns an empty result.
const FALLBACK_URL = 'https://hhycqqtwhdofwbxmnbsr.supabase.co'
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoeWNxcXR3aGRvZndieG1uYnNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NTUyNDMsImV4cCI6MjEwMTAzMTI0M30.cG3WIKObUuwooHRUVpBA5oyFcJbPd49mXEaCrvHGbK4'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_KEY,
)
