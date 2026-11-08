'use client';

import { useState, type ComponentProps } from 'react';
import { useRouter } from 'next/navigation';
import { SETUP_STEPS, stepPath } from '@/lib/setup/steps';
import { AboutForm } from './about-form';
import { StepFrame } from './step-frame';
import type { StepStatus } from './step-status';

const FORM_ID = 'about-form';

type Props = Omit<
  ComponentProps<typeof AboutForm>,
  'formId' | 'onSaved' | 'onStatusChange'
>;

/** Step 1 in the setup flow: the frame around the form, then on to the next step. */
export function AboutStep(props: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<StepStatus>({ pending: false });
  return (
    <StepFrame
      step="about"
      title={SETUP_STEPS[0].label}
      pending={status.pending}
      formId={FORM_ID}
      formError={status.formError}
    >
      <AboutForm
        {...props}
        formId={FORM_ID}
        onStatusChange={setStatus}
        onSaved={() => router.push(stepPath('eligibility'))}
      />
    </StepFrame>
  );
}
