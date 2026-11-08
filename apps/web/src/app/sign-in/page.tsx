import { reasonMessage } from '@/lib/auth/reason-message';
import { SignInForm } from './sign-in-form';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const { reason } = await searchParams;
  const notice = reasonMessage(reason);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-title-3">Sign in to 10xjobs</h1>
        {notice ? <p role="status">{notice}</p> : null}
        <SignInForm />
      </div>
    </main>
  );
}
