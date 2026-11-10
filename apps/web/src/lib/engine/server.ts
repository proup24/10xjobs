import 'server-only';
import { createSupabaseServerClient } from '../supabase/server';
import { createEngineClient, type EngineClient } from './client';

export async function engineClient(): Promise<EngineClient> {
  return createEngineClient({
    url: process.env.ENGINE_URL,
    apiKey: process.env.ENGINE_API_KEY,
    accessToken: async () => {
      const { auth } = await createSupabaseServerClient();
      const { data: claims } = await auth.getClaims();
      if (!claims?.claims) return null;
      const { data } = await auth.getSession();
      return data.session?.access_token ?? null;
    },
  });
}
