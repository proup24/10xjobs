import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const LINK_TYPES = ['invite', 'email'] as const;
type LinkType = (typeof LINK_TYPES)[number];

function isLinkType(value: string | null): value is LinkType {
  return LINK_TYPES.includes(value as LinkType);
}

function redirectTo(request: NextRequest, pathname: string, search = '') {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = search;
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');

  if (!tokenHash || !isLinkType(type)) {
    return redirectTo(request, '/sign-in', '?reason=link');
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });
  if (error) {
    return redirectTo(request, '/sign-in', '?reason=link');
  }
  return redirectTo(request, '/');
}
