import type { SetupDraft } from './answers';
import type { SetupStepId } from './steps';

/** What the next-step rule reads, all from saved data. */
export type SetupSnapshot = {
  name: string | null;
  residenceCountry: string | null;
  acceptsSponsorship: boolean | null;
  draft: SetupDraft | null;
  profile: { id: string; hasResume: boolean } | null;
};

/** The first unfinished step, by the spec's rules in order; no stored flag. */
export function nextSetupStep(s: SetupSnapshot): SetupStepId | 'done' {
  // A blank name counts as none: step 1 never saves one.
  if (s.name === null || s.name.trim() === '') return 'about';
  if (s.residenceCountry === null || s.acceptsSponsorship === null) {
    return 'eligibility';
  }
  if (s.profile === null) return s.draft?.job ? 'terms' : 'job';
  if (!s.profile.hasResume) return 'resume';
  return 'done';
}
