'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SETUP_STEPS, stepPath } from '@/lib/setup/steps';
import { ResumeField, type Resume } from './resume-field';
import { StepFrame } from './step-frame';

const FORM_ID = 'resume-form';

type Props = {
  profileId: string;
  userId: string;
  current: Resume | null;
  /** Defaults to going on to the review. */
  onSaved?: () => void;
};

/** Step 5: the resume field in the setup frame. Continue stays disabled until the profile has a resume. */
export function ResumeStep({ profileId, userId, current, onSaved }: Props) {
  const router = useRouter();
  const [state, setState] = useState<{
    resume: Resume | null;
    uploading: boolean;
  }>({ resume: current, uploading: false });

  return (
    <StepFrame
      step="resume"
      title={SETUP_STEPS[4].label}
      pending={false}
      formId={FORM_ID}
      submitDisabled={state.resume === null || state.uploading}
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (state.resume === null || state.uploading) return;
          if (onSaved) onSaved();
          else router.push(stepPath('review'));
        }}
      >
        <ResumeField
          profileId={profileId}
          userId={userId}
          current={current}
          onChange={setState}
        />
      </form>
    </StepFrame>
  );
}
