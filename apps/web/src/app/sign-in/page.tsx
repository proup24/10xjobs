import { LINK_FAILED, SESSION_EXPIRED } from '@/lib/auth/copy';
import { SignInForm } from './sign-in-form';

const REASONS: Record<string, string> = {
  expired: SESSION_EXPIRED,
  link: LINK_FAILED,
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const { reason } = await searchParams;
  const notice = typeof reason === 'string' ? REASONS[reason] : undefined;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-semibold">Sign in to 10xjobs</h1>
        {notice ? <p role="status">{notice}</p> : null}
        <SignInForm />
      </div>
    </main>
  );
}
