import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && key)

export const supabaseConfigError = supabaseConfigured
  ? null
  : 'Missing Supabase environment variables. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel.'

export const supabase = supabaseConfigured ? createClient(url, key) : null
