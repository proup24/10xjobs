import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@xjobs/database/types';
import { decideRoute, type SessionClaims } from '../auth/session-policy';
import { readPublicSupabaseEnv } from './env';

/** Refreshes the Supabase auth session and forwards refreshed cookies. */
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  const { url, publishableKey } = readPublicSupabaseEnv();
  let response = NextResponse.next({ request });
  let responseHeaders: Record<string, string> = {};

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        responseHeaders = headers;
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  // Validates the JWT and triggers a refresh when it is near expiry.
  const { data } = await supabase.auth.getClaims();
  const claims: SessionClaims | null = data?.claims
    ? {
        sub: data.claims.sub,
        amr: data.claims.amr as SessionClaims['amr'],
      }
    : null;

  const decision = decideRoute({
    pathname: request.nextUrl.pathname,
    claims,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (decision.action === 'continue') return response;

  if (decision.signOut) await supabase.auth.signOut({ scope: 'local' });

  const target = request.nextUrl.clone();
  const [pathname, search = ''] = decision.to.split('?');
  target.pathname = pathname;
  target.search = search ? `?${search}` : '';
  const redirect = NextResponse.redirect(target);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  Object.entries(responseHeaders).forEach(([key, value]) =>
    redirect.headers.set(key, value),
  );
  return redirect;
}
