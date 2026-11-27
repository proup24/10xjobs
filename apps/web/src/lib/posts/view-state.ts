import type { Tab } from '@/lib/matches/group';

/** Which list the page shows. */
export type PostList = 'matches' | 'review' | 'disqualified' | 'junk';

export type PostsViewState = {
  list: PostList;
  tab: Tab;
  profile: string | 'all';
  job: string | null;
};

type Defaults = Partial<PostsViewState>;

const baseDefaults: PostsViewState = {
  list: 'matches',
  tab: '24h',
  profile: 'all',
  job: null,
};

const LISTS: PostList[] = ['matches', 'review', 'disqualified', 'junk'];

export function readPostsViewState(
  params: URLSearchParams,
  defaults: Defaults = {},
): PostsViewState {
  const d = { ...baseDefaults, ...defaults };
  const tab = params.get('tab');
  const list = LISTS.find((l) => l === params.get('list'));
  return {
    list: list ?? d.list,
    tab: tab === '24h' || tab === '7d' ? tab : d.tab,
    profile: params.get('profile') || d.profile,
    job: params.get('job') || null,
  };
}

/** The posts page URL for a state; values equal to the defaults are left out. */
export function postsViewStateHref(
  state: PostsViewState,
  defaults: Defaults = {},
): string {
  const d = { ...baseDefaults, ...defaults };
  const q = new URLSearchParams();
  if (state.list !== d.list) q.set('list', state.list);
  if (state.tab !== d.tab) q.set('tab', state.tab);
  if (state.profile !== d.profile) q.set('profile', state.profile);
  if (state.job) q.set('job', state.job);
  const s = q.toString();
  return s ? `/posts?${s}` : '/posts';
}
