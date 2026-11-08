import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect('/sign-in');

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title-2">10xjobs</h1>
      <p className="text-muted-foreground">Signed in as {data.claims.email}</p>
    </div>
  );
}
