import { describe, expect, it, vi } from 'vitest';

// Only the pages' metadata is under test; stub what they render and load.
vi.mock('./guard', () => ({ requireSetupStep: vi.fn() }));
vi.mock('./actions', () => ({}));
vi.mock('@/lib/setup/load', () => ({}));
vi.mock('@/lib/setup/value-lists', () => ({}));
vi.mock('@/components/setup/about-step', () => ({}));
vi.mock('@/components/setup/eligibility-step', () => ({}));
vi.mock('@/components/setup/job-step', () => ({}));
vi.mock('@/components/setup/terms-step', () => ({}));
vi.mock('@/components/setup/resume-step', () => ({}));
vi.mock('@/components/setup/review', () => ({}));

describe('setup page titles', () => {
  it.each([
    ['about', () => import('./about/page'), 'About you · 10xjobs'],
    [
      'eligibility',
      () => import('./eligibility/page'),
      'Where you can work · 10xjobs',
    ],
    ['job', () => import('./job/page'), 'The job you want · 10xjobs'],
    ['terms', () => import('./terms/page'), 'Location and terms · 10xjobs'],
    ['resume', () => import('./resume/page'), 'Resume · 10xjobs'],
    ['review', () => import('./review/page'), 'Review · 10xjobs'],
  ])('%s', async (_step, load, title) => {
    const page = (await load()) as { metadata?: { title?: string } };
    expect(page.metadata?.title).toBe(title);
  });
});
