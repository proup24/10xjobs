import { setupStepTitle } from '@/lib/setup/steps';
import { redirect } from 'next/navigation';
import { Review } from '@/components/setup/review';
import {
  loadAbout,
  loadEligibility,
  loadResume,
  loadSetupProfile,
} from '@/lib/setup/load';
import { loadValueLists } from '@/lib/setup/value-lists';
import { requireSetupStep } from '../guard';

export const dynamic = 'force-dynamic';

export const metadata = { title: setupStepTitle('review') };

export default async function Page() {
  const { supabase, snapshot } = await requireSetupStep('review');
  // The guard opens the review only once setup is done; this narrows the type.
  if (!snapshot.profile) redirect('/setup');
  const profileId = snapshot.profile.id;
  const [{ answers: about }, eligibility, stored, resume, lists] =
    await Promise.all([
      loadAbout(supabase),
      loadEligibility(supabase),
      loadSetupProfile(supabase, profileId),
      loadResume(supabase, profileId),
      loadValueLists(supabase),
    ]);
  if (!eligibility || !stored || !resume) redirect('/setup');
  // Review is a server component: the value lists are used here, not sent to the browser.
  return (
    <Review
      about={about}
      eligibility={eligibility}
      job={stored.job}
      terms={stored.terms}
      resume={resume}
      lists={lists}
      profileId={profileId}
    />
  );
}
