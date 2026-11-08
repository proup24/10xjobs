import { notFound } from 'next/navigation';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { isShowcaseEnabled } from '@/lib/design/showcase';
import { ComponentsSection } from './_sections/components';
import { TokensSection } from './_sections/tokens';

export const dynamic = 'force-dynamic';

export default function DesignPage() {
  if (!isShowcaseEnabled({ VERCEL_ENV: process.env.VERCEL_ENV })) notFound();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 p-4 sm:p-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-title-2">Design</h1>
        <ThemeToggle />
      </header>
      <TokensSection />
      <ComponentsSection />
    </main>
  );
}
