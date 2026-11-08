import { redirect } from 'next/navigation';
import { SignOutButton } from '@/components/sign-out-button';
import { landingPath } from '@/lib/auth/landing';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect('/sign-in');

  if ((await landingPath(supabase)) === '/setup') redirect('/setup');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-title-2">10xjobs</h1>
      <p className="text-muted-foreground">Signed in as {data.claims.email}</p>
      <SignOutButton />
    </main>
  );
}
