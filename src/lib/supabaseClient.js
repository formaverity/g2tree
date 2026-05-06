import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || ''
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Falls back to placeholder values when env vars are absent (dev without .env.local).
// All API calls will fail gracefully until real values are provided.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder-anon-key',
)

export const supabaseConfigured = Boolean(url && key)
