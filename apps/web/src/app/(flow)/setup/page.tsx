import { requireSetupStep } from './guard';

export const dynamic = 'force-dynamic';

/** Sends the user to their next unfinished step, or home when setup is done. */
export default async function SetupPage() {
  await requireSetupStep('index');
  return null;
}
