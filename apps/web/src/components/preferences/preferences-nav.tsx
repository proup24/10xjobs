'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useUnsavedChanges } from '@/components/layout/unsaved-changes';
import {
  VerticalNav,
  type NavigateEvent,
  type VerticalNavGroup,
  type VerticalNavItem,
} from '@/components/ui/vertical-nav';
import type { ProfileListItem } from '@/lib/preferences/profiles';
import { SECTION_TITLES } from '@/lib/preferences/titles';

const BASE = '/preferences';

export const profilePath = (id: string, section?: string) =>
  `${BASE}/profiles/${id}${section ? `/${section}` : ''}`;

const PROFILE_SECTIONS = (['job', 'terms', 'resume'] as const).map(
  (section) => ({ section, label: SECTION_TITLES[section] }),
);

type Props = {
  items: Pick<ProfileListItem, 'id' | 'hasResume'>[];
  /** Profile id → its nav label (see `profileLabels`). */
  labels: Record<string, string>;
};

/** A click the browser should handle itself: a new tab or window, not a page change. */
function opensElsewhere(event: NavigateEvent): boolean {
  if (!('button' in event)) return false;
  const e = event as React.MouseEvent;
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

/** The Preferences side nav: the user's own sections, then each profile and its sections. */
export function PreferencesNav({ items, labels }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { confirmLeave } = useUnsavedChanges();

  const you: VerticalNavItem[] = [
    { href: `${BASE}/contacts`, label: SECTION_TITLES.contacts },
    { href: `${BASE}/eligibility`, label: SECTION_TITLES.eligibility },
  ].map((i) => ({ ...i, current: pathname === i.href }));

  const profiles: VerticalNavItem[] = items.map((p) => {
    const root = profilePath(p.id);
    const selected = pathname === root || pathname.startsWith(`${root}/`);
    return {
      // Without a resume the profile opens on the section it still needs.
      href: p.hasResume ? root : profilePath(p.id, 'resume'),
      label: labels[p.id] ?? 'Profile',
      badge: p.hasResume ? undefined : 'Needs a resume',
      current: pathname === root,
      children: selected
        ? PROFILE_SECTIONS.map(({ section, label }) => {
            const href = profilePath(p.id, section);
            return { href, label, current: pathname === href };
          })
        : undefined,
    };
  });

  const groups: VerticalNavGroup[] = [
    { label: 'You', items: you },
    { label: 'Profiles', items: profiles },
  ];

  return (
    <VerticalNav
      groups={groups}
      label="Preferences"
      onNavigate={(href, event) => {
        if (opensElsewhere(event)) return;
        event.preventDefault();
        confirmLeave(() => router.push(href));
      }}
    />
  );
}
