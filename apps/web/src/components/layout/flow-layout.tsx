import { Brand } from '@/components/layout/brand';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export function FlowLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between px-4 md:px-6">
        <Brand />
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4 md:p-6">
        {children}
      </main>
    </div>
  );
}
