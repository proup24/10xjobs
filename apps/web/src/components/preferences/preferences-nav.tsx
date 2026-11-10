'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  opensElsewhere,
  useUnsavedChanges,
} from '@/components/layout/unsaved-changes';
import {
  VerticalNav,
  type VerticalNavGroup,
  type VerticalNavItem,
} from '@/components/ui/vertical-nav';
import type { ProfileListItem } from '@/lib/preferences/profiles';
import { SECTION_TITLES } from '@/lib/preferences/titles';
import { NewProfileAction } from './new-profile-action';

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
  /** A new profile's draft exists: "+ New profile" offers to continue it. */
  draftInProgress: boolean;
};

/** The Preferences side nav: the user's own sections, then each profile and its sections. */
export function PreferencesNav({ items, labels, draftInProgress }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { confirmLeave } = useUnsavedChanges();

  const you: VerticalNavItem[] = [
    { href: `${BASE}/contacts`, label: SECTION_TITLES.contacts },
    { href: `${BASE}/eligibility`, label: SECTION_TITLES.eligibility },
  ].map((i) => ({ ...i, current: pathname === i.href }));

  const profiles: VerticalNavItem[] = items.map((p) => {
    const selected = pathname.startsWith(`${profilePath(p.id)}/`);
    return {
      // Without a resume the profile opens on the section it still needs.
      href: profilePath(p.id, p.hasResume ? 'job' : 'resume'),
      label: labels[p.id] ?? 'Profile',
      badge: p.hasResume ? undefined : 'Needs a resume',
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
    {
      label: 'Profiles',
      items: profiles,
      action: (
        <NewProfileAction
          count={items.length}
          draftInProgress={draftInProgress}
        />
      ),
    },
  ];

  return (
    <VerticalNav
      groups={groups}
      label="Preferences"
      onNavigate={(href, event) => {
        if (opensElsewhere(event)) return;
        event.preventDefault();
        // Already here: nothing to leave, nothing to ask.
        if (href === pathname) return;
        confirmLeave(() => router.push(href));
      }}
    />
  );
}
