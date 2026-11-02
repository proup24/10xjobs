export interface PublicSupabaseEnv {
  url: string;
  publishableKey: string;
}

/**
 * Reads the public Supabase settings when called, never at module load, so
 * `next build` works without env and a missing value fails at request time.
 * Keep the two literal `process.env.NEXT_PUBLIC_*` accesses: Next inlines
 * them into the browser bundle only in that form.
 */
export function readPublicSupabaseEnv(): PublicSupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!publishableKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set');
  }
  return { url, publishableKey };
}
