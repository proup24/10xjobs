import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceSwitch } from './source-switch';

afterEach(cleanup);

describe('SourceSwitch', () => {
  it('links Job board to / and Social posts to /posts', () => {
    render(<SourceSwitch current="job_board" />);
    expect(
      screen.getByRole('link', { name: 'Job board' }).getAttribute('href'),
    ).toBe('/');
    expect(
      screen.getByRole('link', { name: 'Social posts' }).getAttribute('href'),
    ).toBe('/posts');
  });

  it('marks Social posts current on posts', () => {
    render(<SourceSwitch current="posts" />);
    expect(
      screen
        .getByRole('link', { name: 'Social posts' })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(
      screen.getByRole('link', { name: 'Job board' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('marks Job board current on the job board', () => {
    render(<SourceSwitch current="job_board" />);
    expect(
      screen.getByRole('link', { name: 'Job board' }).getAttribute('aria-current'),
    ).toBe('page');
  });
});
