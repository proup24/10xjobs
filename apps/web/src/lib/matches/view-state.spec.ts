import { describe, expect, it } from 'vitest';
import {
  defaultProfile,
  readViewState,
  viewStateHref,
  type ViewState,
} from './view-state';

const defaults = { tab: '24h', profile: 'all' } as const;

describe('readViewState', () => {
  it('falls back to the defaults', () => {
    expect(readViewState(new URLSearchParams(), defaults)).toEqual({
      tab: '24h',
      profile: 'all',
      source: 'all',
      job: null,
    });
  });
  it('round-trips through viewStateHref', () => {
    const state: ViewState = {
      tab: '7d',
      profile: 'p1',
      source: 'ASHBY',
      job: 'j1',
    };
    const href = viewStateHref(state, defaults);
    expect(href).toBe('/?tab=7d&profile=p1&source=ASHBY&job=j1');
    expect(
      readViewState(new URLSearchParams(href.split('?')[1]), defaults),
    ).toEqual(state);
  });
  it('omits defaults from the href', () => {
    expect(
      viewStateHref(
        { tab: '24h', profile: 'all', source: 'all', job: null },
        defaults,
      ),
    ).toBe('/');
  });
  it('ignores a bad tab', () => {
    expect(readViewState(new URLSearchParams('tab=x'), defaults).tab).toBe(
      '24h',
    );
  });
});

describe('defaultProfile', () => {
  const p = (id: string, state: 'draft' | 'published') => ({ id, state });
  it('is all with two published', () => {
    expect(defaultProfile([p('a', 'published'), p('b', 'published')])).toBe(
      'all',
    );
  });
  it('is the published one beside a draft', () => {
    expect(defaultProfile([p('a', 'draft'), p('b', 'published')])).toBe('b');
  });
  it('is the draft when only a draft exists', () => {
    expect(defaultProfile([p('a', 'draft')])).toBe('a');
  });
});
