'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ComponentProps,
} from 'react';
import { useRouter } from 'next/navigation';
import { publishProfileAction } from '@/app/(app)/preferences/publish-action';
import { useUnsavedChanges } from '@/components/layout/unsaved-changes';
import { JobForm } from '@/components/setup/job-form';
import { ResumeField, type Resume } from '@/components/setup/resume-field';
import { StepFrame, type StepFlow } from '@/components/setup/step-frame';
import type { StepStatus } from '@/components/setup/step-status';
import { TermsForm } from '@/components/setup/terms-form';
import type { CreateResult } from '@/lib/preferences/new-profile';
import { NEW_PROFILE_STEPS } from '@/lib/preferences/new-profile-steps';
import type { SaveResult } from '@/lib/setup/save';

const BASE = '/preferences/new';
const JOB_LEAD = 'We only show you jobs that match every answer here.';

/** Steps 1 and 2 live under the chooser; the resume step needs the created profile's id. */
const flowFor = (profileId?: string): StepFlow => ({
  steps: NEW_PROFILE_STEPS,
  pathFor: (id) =>
    id === 'resume' && profileId
      ? `${BASE}/${profileId}/resume`
      : `${BASE}/${id}`,
});

const title = (id: (typeof NEW_PROFILE_STEPS)[number]['id']) =>
  NEW_PROFILE_STEPS.find((s) => s.id === id)?.label ?? '';

/** The step forms speak `SaveResult`: a created profile is, to them, a save. */
export function toSaveResult(result: CreateResult): SaveResult {
  return result.status === 'created' ? { status: 'saved' } : result;
}

/** The page's unsaved-changes guard for a step form, cleared when the step goes away. */
function useStepGuard() {
  const { setDirty } = useUnsavedChanges();
  useEffect(() => () => setDirty(false), [setDirty]);
  return setDirty;
}

type JobProps = Omit<
  ComponentProps<typeof JobForm>,
  'formId' | 'onSaved' | 'onStatusChange' | 'onDirtyChange'
>;

/** Step 1: the job answers, saved into the draft, then on to the terms. */
export function NewProfileJobStep(props: JobProps) {
  const router = useRouter();
  const setDirty = useStepGuard();
  const [status, setStatus] = useState<StepStatus>({ pending: false });
  const onSaved = useCallback(() => {
    setDirty(false);
    router.push(`${BASE}/terms`);
  }, [router, setDirty]);
  return (
    <StepFrame
      flow={flowFor()}
      step="job"
      title={title('job')}
      lead={JOB_LEAD}
      pending={status.pending}
      formId="new-profile-job-form"
      formError={status.formError}
    >
      <JobForm
        {...props}
        formId="new-profile-job-form"
        onStatusChange={setStatus}
        onDirtyChange={setDirty}
        onSaved={onSaved}
      />
    </StepFrame>
  );
}

type TermsProps = Omit<
  ComponentProps<typeof TermsForm>,
  | 'formId'
  | 'onSave'
  | 'onSaved'
  | 'onStatusChange'
  | 'onDirtyChange'
  | 'hasProfile'
> & {
  /** The terms action, bound to the draft's new-profile id. */
  onSave: (input: unknown) => Promise<CreateResult>;
};

/**
 * Step 2: the terms. Its save creates the profile; the created id is kept from the
 * action's result and the step goes on to that profile's resume.
 */
export function NewProfileTermsStep({ onSave, ...props }: TermsProps) {
  const router = useRouter();
  const setDirty = useStepGuard();
  const [status, setStatus] = useState<StepStatus>({ pending: false });
  const created = useRef<string | null>(null);

  const save = useCallback(
    async (input: unknown) => {
      created.current = null;
      const result = await onSave(input);
      if (result.status === 'created') created.current = result.profileId;
      return toSaveResult(result);
    },
    [onSave],
  );

  const onSaved = useCallback(() => {
    setDirty(false);
    const id = created.current;
    if (id) {
      router.push(`${BASE}/${id}/resume`);
      // The nav now lists the new profile, with "Needs a resume".
      router.refresh();
    } else {
      // Saved, but the draft has no job answers yet: that step comes first.
      router.push(`${BASE}/job`);
    }
  }, [router, setDirty]);

  return (
    <StepFrame
      flow={flowFor()}
      step="terms"
      title={title('terms')}
      pending={status.pending}
      formId="new-profile-terms-form"
      formError={status.formError}
    >
      <TermsForm
        {...props}
        hasProfile={false}
        formId="new-profile-terms-form"
        onSave={save}
        onStatusChange={setStatus}
        onDirtyChange={setDirty}
        onSaved={onSaved}
      />
    </StepFrame>
  );
}

type ResumeProps = {
  profileId: string;
  userId: string;
  current: Resume | null;
};

/**
 * Step 3: the created profile's resume. A copied resume shows with Replace; a blank
 * profile needs an upload before Finish. Finish publishes it and opens its matches.
 */
export function NewProfileResumeStep({
  profileId,
  userId,
  current,
}: ResumeProps) {
  const router = useRouter();
  const [state, setState] = useState<{
    resume: Resume | null;
    uploading: boolean;
  }>({ resume: current, uploading: false });
  const last = useRef<Resume | null | undefined>(undefined);
  const ready = state.resume !== null && !state.uploading;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();

  return (
    <StepFrame
      flow={flowFor(profileId)}
      step="resume"
      title={title('resume')}
      pending={pending}
      formError={error}
      formId="new-profile-resume-form"
      submitLabel="Finish"
      submitDisabled={!ready}
      // The draft is gone once the profile exists: back is the profile's own terms.
      onBack={() => router.push(`/preferences/profiles/${profileId}/terms`)}
    >
      <form
        id="new-profile-resume-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || pending) return;
          setError(undefined);
          start(async () => {
            const outcome = await publishProfileAction(profileId);
            if (outcome.status === 'published') router.push(outcome.href);
            else setError(outcome.message);
          });
        }}
      >
        <ResumeField
          profileId={profileId}
          userId={userId}
          current={current}
          onChange={(next) => {
            setState(next);
            // The first report is the resume on mount; a later new one is an upload,
            // which clears the nav's "Needs a resume".
            if (last.current !== undefined && next.resume !== last.current) {
              router.refresh();
            }
            last.current = next.resume;
          }}
        />
      </form>
    </StepFrame>
  );
}
