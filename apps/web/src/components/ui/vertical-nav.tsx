'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type VerticalNavItem = {
  href: string;
  label: string;
  current?: boolean;
  badge?: string;
  children?: VerticalNavItem[];
};

type VerticalNavGroup = {
  label: string;
  items: VerticalNavItem[];
  /** Rendered under the group, e.g. a "New profile" button. */
  action?: React.ReactNode;
};

/** What `onNavigate` receives: a React MouseEvent from a link, or a stand-in
 * with only `preventDefault` from the phone select. */
type NavigateEvent = { preventDefault(): void };

type VerticalNavProps = {
  groups: VerticalNavGroup[];
  /** Accessible name of the `<nav>` and of the phone select. */
  label: string;
  /** Called before navigating; call `event.preventDefault()` to cancel. */
  onNavigate?: (href: string, event: NavigateEvent) => void;
};

type FlatItem = { href: string; label: string; current: boolean };

function flatten(items: VerticalNavItem[], parent?: string): FlatItem[] {
  return items.flatMap((item) => {
    const children = item.children ?? [];
    // A parent that opens the same page as one of its children is listed once.
    const duplicated = children.some((c) => c.href === item.href);
    return [
      ...(duplicated
        ? []
        : [
            {
              href: item.href,
              label: parent ? `${parent}: ${item.label}` : item.label,
              current: Boolean(item.current),
            },
          ]),
      ...flatten(children, item.label),
    ];
  });
}

function NavLinks({
  items,
  onNavigate,
  nested = false,
}: {
  items: VerticalNavItem[];
  onNavigate?: VerticalNavProps['onNavigate'];
  nested?: boolean;
}) {
  return (
    <ul className={cn('flex flex-col gap-0.5', nested && 'mt-0.5 ml-3')}>
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            aria-current={item.current ? 'page' : undefined}
            onClick={(event) => onNavigate?.(item.href, event)}
            className={cn(
              'flex min-h-8 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              item.current
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <span className="min-w-0 break-words">{item.label}</span>
            {item.badge ? (
              <>
                <span className="sr-only">, </span>
                <Badge variant="secondary">{item.badge}</Badge>
              </>
            ) : null}
          </Link>
          {item.children?.length ? (
            <NavLinks items={item.children} onNavigate={onNavigate} nested />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function VerticalNav({ groups, label, onNavigate }: VerticalNavProps) {
  const router = useRouter();
  const id = React.useId();
  const flat = groups.flatMap((g) => flatten(g.items));
  const selectItems = flat.map((i) => ({ value: i.href, label: i.label }));
  const current = flat.find((i) => i.current)?.href ?? null;

  function choose(href: string | null) {
    if (!href) return;
    let prevented = false;
    onNavigate?.(href, {
      preventDefault: () => {
        prevented = true;
      },
    });
    if (!prevented) router.push(href);
  }

  return (
    <div data-slot="vertical-nav">
      <nav aria-label={label} className="flex flex-col gap-6 max-md:hidden">
        {groups.map((group, i) => (
          <div key={group.label} className="flex flex-col gap-1">
            <p
              id={`${id}-${i}`}
              className="px-2 text-xs font-medium text-muted-foreground"
            >
              {group.label}
            </p>
            <div aria-labelledby={`${id}-${i}`} role="group">
              <NavLinks items={group.items} onNavigate={onNavigate} />
            </div>
            {group.action}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-3 md:hidden">
        <Select items={selectItems} value={current} onValueChange={choose}>
          <SelectTrigger aria-label={label} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {selectItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {groups.map((group) =>
          group.action ? <div key={group.label}>{group.action}</div> : null,
        )}
      </div>
    </div>
  );
}

export { VerticalNav };
export type { VerticalNavGroup, VerticalNavItem, NavigateEvent };
