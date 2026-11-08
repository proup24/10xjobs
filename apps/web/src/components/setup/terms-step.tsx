'use client';

import { useState, type ComponentProps } from 'react';
import { useRouter } from 'next/navigation';
import { SETUP_STEPS, stepPath } from '@/lib/setup/steps';
import { StepFrame } from './step-frame';
import type { StepStatus } from './step-status';
import { TermsForm } from './terms-form';

const FORM_ID = 'terms-form';

type Props = Omit<
  ComponentProps<typeof TermsForm>,
  'formId' | 'onSaved' | 'onStatusChange'
>;

/** Step 4 in the setup flow: the frame around the form, then on to the resume step. */
export function TermsStep(props: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<StepStatus>({ pending: false });
  return (
    <StepFrame
      step="terms"
      title={SETUP_STEPS[3].label}
      pending={status.pending}
      formId={FORM_ID}
      formError={status.formError}
    >
      <TermsForm
        {...props}
        formId={FORM_ID}
        onStatusChange={setStatus}
        onSaved={() => router.push(stepPath('resume'))}
      />
    </StepFrame>
  );
}
