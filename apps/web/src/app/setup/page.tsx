import { redirect } from 'next/navigation';
import { SignOutButton } from '@/components/sign-out-button';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect('/sign-in');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">Set up your profile</h1>
      <p className="text-muted-foreground">Guided setup is coming soon.</p>
      <SignOutButton />
    </main>
  );
}
