import type { ProfileListItem } from '@/lib/preferences/profiles';
import type { Tab } from './group';

export type ViewState = {
  tab: Tab;
  profile: string | 'all';
  source: string | 'all';
  job: string | null;
};

type Defaults = Partial<ViewState>;

const baseDefaults: ViewState = {
  tab: '24h',
  profile: 'all',
  source: 'all',
  job: null,
};

export function readViewState(
  params: URLSearchParams,
  defaults: Defaults = {},
): ViewState {
  const d = { ...baseDefaults, ...defaults };
  const tab = params.get('tab');
  return {
    tab: tab === '24h' || tab === '7d' ? tab : d.tab,
    profile: params.get('profile') || d.profile,
    source: params.get('source') || d.source,
    job: params.get('job') || null,
  };
}

/** The matches page URL for a state; values equal to the defaults are left out. */
export function viewStateHref(
  state: ViewState,
  defaults: Defaults = {},
): string {
  const d = { ...baseDefaults, ...defaults };
  const q = new URLSearchParams();
  if (state.tab !== d.tab) q.set('tab', state.tab);
  if (state.profile !== d.profile) q.set('profile', state.profile);
  if (state.source !== 'all') q.set('source', state.source);
  if (state.job) q.set('job', state.job);
  const s = q.toString();
  return s ? `/?${s}` : '/';
}

/** 'all' when two or more profiles are published, else the published one, else the first draft. */
export function defaultProfile(
  profiles: Pick<ProfileListItem, 'id' | 'state'>[],
): string | 'all' {
  const published = profiles.filter((p) => p.state === 'published');
  if (published.length >= 2) return 'all';
  return published[0]?.id ?? profiles[0]?.id ?? 'all';
}

/**
 * The URL's profile when the page offers it: one of the user's profiles, or 'all' when two or
 * more are published. Anything else (a deleted profile, a foreign id) falls back to the
 * default.
 */
export function knownProfile(
  profile: string | 'all',
  profiles: Pick<ProfileListItem, 'id' | 'state'>[],
): string | 'all' {
  const published = profiles.filter((p) => p.state === 'published');
  const known =
    profile === 'all'
      ? published.length >= 2
      : profiles.some((p) => p.id === profile);
  return known ? profile : defaultProfile(profiles);
}
