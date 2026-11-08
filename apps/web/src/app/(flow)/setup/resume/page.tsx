import { setupStepTitle } from '@/lib/setup/steps';
import { redirect } from 'next/navigation';
import { ResumeStep } from '@/components/setup/resume-step';
import { loadResume } from '@/lib/setup/load';
import { requireSetupStep } from '../guard';

export const dynamic = 'force-dynamic';

export const metadata = { title: setupStepTitle('resume') };

export default async function Page() {
  const { supabase, userId, snapshot } = await requireSetupStep('resume');
  // The guard opens step 5 only once the profile exists; this narrows the type.
  if (!snapshot.profile) redirect('/setup');
  const current = await loadResume(supabase, snapshot.profile.id);
  return (
    <ResumeStep
      profileId={snapshot.profile.id}
      userId={userId}
      current={current}
    />
  );
}
