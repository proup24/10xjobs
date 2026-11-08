import { reasonMessage } from '@/lib/auth/reason-message';
import { Brand } from '@/components/layout/brand';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SignInForm } from './sign-in-form';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const { reason } = await searchParams;
  const notice = reasonMessage(reason);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <Brand />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-title-4">
            <h1>Sign in to 10xjobs</h1>
          </CardTitle>
          <CardDescription>
            We email you a 6-digit code. No password needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {notice ? (
            <p role="status" className="text-sm">
              {notice}
            </p>
          ) : null}
          <SignInForm />
        </CardContent>
      </Card>
    </main>
  );
}
