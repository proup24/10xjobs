import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

const ITEMS = [
  { value: 'job_board', href: '/', label: 'Job board' },
  { value: 'posts', href: '/posts', label: 'Social posts' },
] as const;

/** Matches' two sub-pages; shown only when a profile has post search on. */
export function SourceSwitch({ current }: { current: 'job_board' | 'posts' }) {
  return (
    <nav aria-label="Matches source" className="flex gap-1">
      {ITEMS.map((item) => {
        const on = item.value === current;
        return (
          <Link
            key={item.value}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={buttonVariants({
              variant: on ? 'secondary' : 'ghost',
              size: 'sm',
            })}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
