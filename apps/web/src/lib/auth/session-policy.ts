export const MAX_SESSION_AGE_SECONDS = 604_800;
export const PUBLIC_PATHS = ['/sign-in', '/auth/confirm', '/design'];

export type SessionClaims = {
  sub: string;
  amr?: { method: string; timestamp: number }[];
};

export type RouteDecision =
  | { action: 'continue' }
  | { action: 'redirect'; to: string; signOut: boolean };

/** Newest authentication time across all amr entries, in epoch seconds. */
export function signedInAt(claims: SessionClaims): number | null {
  if (!claims.amr?.length) return null;
  const at = Math.max(...claims.amr.map((entry) => Number(entry.timestamp)));
  return Number.isFinite(at) ? at : null;
}

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function decideRoute(input: {
  pathname: string;
  claims: SessionClaims | null;
  nowSeconds: number;
}): RouteDecision {
  const { pathname, claims, nowSeconds } = input;

  if (claims) {
    const at = signedInAt(claims);
    if (at === null || nowSeconds - at > MAX_SESSION_AGE_SECONDS) {
      return {
        action: 'redirect',
        to: '/sign-in?reason=expired',
        signOut: true,
      };
    }
    if (pathname === '/sign-in') {
      return { action: 'redirect', to: '/', signOut: false };
    }
    return { action: 'continue' };
  }

  if (!isPublic(pathname)) {
    return { action: 'redirect', to: '/sign-in', signOut: false };
  }
  return { action: 'continue' };
}
