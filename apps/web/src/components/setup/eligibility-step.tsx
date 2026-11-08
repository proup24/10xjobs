'use client';

import { useState, type ComponentProps } from 'react';
import { useRouter } from 'next/navigation';
import { SETUP_STEPS, stepPath } from '@/lib/setup/steps';
import { EligibilityForm } from './eligibility-form';
import { StepFrame } from './step-frame';
import type { StepStatus } from './step-status';

const FORM_ID = 'eligibility-form';

type Props = Omit<
  ComponentProps<typeof EligibilityForm>,
  'formId' | 'onSaved' | 'onStatusChange'
>;

/** Step 2 in the setup flow: the frame around the form, then on to the next step. */
export function EligibilityStep(props: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<StepStatus>({ pending: false });
  return (
    <StepFrame
      step="eligibility"
      title={SETUP_STEPS[1].label}
      pending={status.pending}
      formId={FORM_ID}
      formError={status.formError}
    >
      <EligibilityForm
        {...props}
        formId={FORM_ID}
        onStatusChange={setStatus}
        onSaved={() => router.push(stepPath('job'))}
      />
    </StepFrame>
  );
}
