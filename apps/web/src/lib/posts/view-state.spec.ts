import { describe, expect, it } from 'vitest';
import { postsViewStateHref, readPostsViewState } from './view-state';

describe('readPostsViewState', () => {
  it('parses the list and falls back to matches', () => {
    expect(readPostsViewState(new URLSearchParams('list=junk')).list).toBe(
      'junk',
    );
    expect(readPostsViewState(new URLSearchParams('list=bogus')).list).toBe(
      'matches',
    );
  });

  it('parses tab, profile and job', () => {
    expect(
      readPostsViewState(new URLSearchParams('tab=7d&profile=p1&job=j1')),
    ).toEqual({ list: 'matches', tab: '7d', profile: 'p1', job: 'j1' });
  });
});

describe('postsViewStateHref', () => {
  const base = {
    list: 'matches',
    tab: '24h',
    profile: 'all',
    job: null,
  } as const;
  it('leaves out defaults', () => {
    expect(postsViewStateHref(base)).toBe('/posts');
    expect(postsViewStateHref({ ...base, list: 'disqualified' })).toBe(
      '/posts?list=disqualified',
    );
    expect(
      postsViewStateHref({ ...base, tab: '7d', profile: 'p', job: 'j' }),
    ).toBe('/posts?tab=7d&profile=p&job=j');
  });
});
