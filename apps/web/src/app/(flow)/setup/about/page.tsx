import { AboutForm } from '@/components/setup/about-form';
import { loadAbout } from '@/lib/setup/load';
import { requireSetupStep } from '../guard';
import { saveAboutAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const { supabase } = await requireSetupStep('about');
  const { email, answers } = await loadAbout(supabase);
  return <AboutForm email={email} initial={answers} onSave={saveAboutAction} />;
}
