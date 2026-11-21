'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PUBLISH_FAILED_MESSAGE } from '@/lib/profiles/publish';
import { publishProfileAction } from '@/app/(app)/preferences/publish-action';
import { StepFrame } from './step-frame';

const FORM_ID = 'review-form';

/**
 * The review's frame: Finish publishes the profile, then opens its matches view. The
 * button stays disabled while the request runs, so a double click sends one.
 */
export function ReviewFinish({
  profileId,
  children,
}: {
  profileId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();
  return (
    <StepFrame
      step="review"
      title="Review"
      pending={pending}
      submitLabel="Finish"
      formId={FORM_ID}
      formError={error}
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          setError(undefined);
          start(async () => {
            try {
              const outcome = await publishProfileAction(profileId);
              if (outcome.status === 'published') router.push(outcome.href);
              else setError(outcome.message);
            } catch {
              // A dropped request or a deploy's version skew: stay on the step.
              setError(PUBLISH_FAILED_MESSAGE);
            }
          });
        }}
      >
        {children}
      </form>
    </StepFrame>
  );
}
