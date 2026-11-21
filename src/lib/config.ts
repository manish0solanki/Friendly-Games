/**
 * Supabase settings. Fill these in via environment variables at build time
 * (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) or edit the fallbacks below.
 * The anon key is designed to be public — security comes from the database's row-level security.
 * When left empty, the app runs in Demo mode (data stays in this browser).
 */
export const SUPABASE_URL: string = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') || '';
export const SUPABASE_ANON_KEY: string = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';

export const IS_ONLINE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
