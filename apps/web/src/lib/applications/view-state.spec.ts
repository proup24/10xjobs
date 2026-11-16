import { describe, expect, it } from 'vitest';
import { appViewHref, readAppView, type AppView } from './view-state';

const read = (q: string) => readAppView(new URLSearchParams(q));

describe('readAppView', () => {
  it('defaults to applied with no job', () => {
    expect(read('')).toEqual({ status: 'applied', job: null });
  });

  it('reads an unknown status as applied', () => {
    expect(read('status=rejected&job=j1')).toEqual({
      status: 'applied',
      job: 'j1',
    });
  });

  it('round-trips through appViewHref', () => {
    for (const v of [
      { status: 'applied', job: null },
      { status: 'applied', job: 'j1' },
      { status: 'dismissed', job: null },
      { status: 'dismissed', job: 'j2' },
    ] satisfies AppView[]) {
      const href = appViewHref(v);
      expect(readAppView(new URL(href, 'http://x').searchParams)).toEqual(v);
    }
  });
});

describe('appViewHref', () => {
  it('leaves the default status out', () => {
    expect(appViewHref({ status: 'applied', job: null })).toBe('/applications');
    expect(appViewHref({ status: 'applied', job: 'j1' })).toBe(
      '/applications?job=j1',
    );
    expect(appViewHref({ status: 'dismissed', job: 'j1' })).toBe(
      '/applications?status=dismissed&job=j1',
    );
  });
});
