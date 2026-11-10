import { describe, expect, it, vi } from 'vitest';

// Only the pages' metadata is under test; stub what they render and load.
vi.mock('./guard', () => ({}));
vi.mock('./actions', () => ({}));
vi.mock('@/lib/setup/load', () => ({}));
vi.mock('./data', () => ({}));
vi.mock('@/components/preferences/sections', () => ({}));
vi.mock('./new/actions', () => ({}));
vi.mock('@/components/preferences/start-chooser', () => ({}));
vi.mock('@/components/preferences/new-profile-action', () => ({}));
vi.mock('@/components/preferences/new-profile-steps', () => ({}));

describe('preferences page titles', () => {
  it.each([
    ['Contacts · Preferences · 10xjobs', () => import('./contacts/page')],
    [
      'Where you can work · Preferences · 10xjobs',
      () => import('./eligibility/page'),
    ],
    [
      'The job you want · Preferences · 10xjobs',
      () => import('./profiles/[profileId]/job/page'),
    ],
    [
      'Location and terms · Preferences · 10xjobs',
      () => import('./profiles/[profileId]/terms/page'),
    ],
    [
      'Resume · Preferences · 10xjobs',
      () => import('./profiles/[profileId]/resume/page'),
    ],
    ['New profile · Preferences · 10xjobs', () => import('./new/page')],
    ['New profile · Preferences · 10xjobs', () => import('./new/job/page')],
    ['New profile · Preferences · 10xjobs', () => import('./new/terms/page')],
    [
      'New profile · Preferences · 10xjobs',
      () => import('./new/[profileId]/resume/page'),
    ],
  ] as const)('%s', async (title, load) => {
    const page = (await load()) as { metadata?: { title?: string } };
    expect(page.metadata?.title).toBe(title);
  });
});
