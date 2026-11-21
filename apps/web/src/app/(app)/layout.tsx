import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { isAdmin } from '@/lib/admin/is-admin';
import { landingPath } from '@/lib/auth/landing';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect('/sign-in');
  if ((await landingPath(supabase)) === '/setup') redirect('/setup');
  // Not awaited: the menu shows the admin item when the engine answers.
  return <AppShell admin={isAdmin()}>{children}</AppShell>;
}
