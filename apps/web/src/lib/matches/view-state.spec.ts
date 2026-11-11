import { describe, expect, it } from 'vitest';
import {
  defaultProfile,
  knownProfile,
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

// A deleted profile reached by back or a bookmark, or "all" with fewer than two published,
// would otherwise show an empty select and "No matches" beside real matches.
describe('knownProfile', () => {
  const p = (id: string, state: 'draft' | 'published') => ({ id, state });
  const two = [p('a', 'published'), p('b', 'published')];
  const one = [p('a', 'draft'), p('b', 'published')];
  it('keeps a known profile id', () => {
    expect(knownProfile('a', two)).toBe('a');
    expect(knownProfile('a', one)).toBe('a');
  });
  it('keeps all when "All profiles" is offered', () => {
    expect(knownProfile('all', two)).toBe('all');
  });
  it('falls back to the default for an unknown id', () => {
    expect(knownProfile('gone', two)).toBe('all');
    expect(knownProfile('gone', one)).toBe('b');
  });
  it('falls back to the default for all with fewer than two published', () => {
    expect(knownProfile('all', one)).toBe('b');
    expect(knownProfile('all', [p('a', 'published')])).toBe('a');
  });
});
