import { StepFrame } from '@/components/setup/step-frame';
import { requireSetupStep } from '../guard';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireSetupStep('review');
  return (
    <StepFrame
      step="review"
      title="Review"
      pending={false}
      formId="setup-form"
    />
  );
}
