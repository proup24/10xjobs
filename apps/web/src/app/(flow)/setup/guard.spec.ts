// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { setupRedirect } from './guard';

describe('setupRedirect', () => {
  it.each([
    ['index', 'job', '/setup/job'],
    ['index', 'done', '/'],
    ['resume', 'eligibility', '/setup/eligibility'],
    ['about', 'terms', null],
    ['terms', 'terms', null],
    ['review', 'resume', '/setup/resume'],
    ['review', 'done', null],
    ['job', 'done', null],
  ] as const)('%s with next %s -> %s', (step, next, expected) => {
    expect(setupRedirect(step, next)).toBe(expected);
  });
});
