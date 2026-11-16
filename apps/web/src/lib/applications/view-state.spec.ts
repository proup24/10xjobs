import { describe, expect, it } from 'vitest';
import {
  appViewHref,
  readAppView,
  viewForJob,
  type AppView,
} from './view-state';

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

// A link can name a job under the wrong status (an old link, or one built by hand): the
// tab follows the job, so it is not shown open under a list it isn't in.
describe('viewForJob', () => {
  const decisions = [
    { jobId: 'a1', status: 'applied' },
    { jobId: 'd1', status: 'dismissed' },
  ];

  it("shows the open job's status", () => {
    expect(viewForJob({ status: 'applied', job: 'd1' }, decisions)).toEqual({
      status: 'dismissed',
      job: 'd1',
    });
    expect(viewForJob({ status: 'dismissed', job: 'a1' }, decisions)).toEqual({
      status: 'applied',
      job: 'a1',
    });
  });

  it('keeps the view when it already matches, or has no known job', () => {
    for (const v of [
      { status: 'applied', job: 'a1' },
      { status: 'dismissed', job: 'd1' },
      { status: 'dismissed', job: null },
      { status: 'dismissed', job: 'gone' },
    ] satisfies AppView[]) {
      expect(viewForJob(v, decisions)).toEqual(v);
    }
  });
});
