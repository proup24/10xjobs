import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Code, Mark, TextLink } from './text';

afterEach(cleanup);

describe('inline text', () => {
  it('Code is a code element on the muted surface', () => {
    render(<Code>pnpm</Code>);
    const el = screen.getByText('pnpm');
    expect(el.tagName).toBe('CODE');
    expect(el.className).toContain('bg-muted');
    expect(el.className).toContain('font-mono');
  });
  it('Mark is a mark element with the mark roles', () => {
    render(<Mark>hit</Mark>);
    const el = screen.getByText('hit');
    expect(el.tagName).toBe('MARK');
    expect(el.className).toContain('bg-mark');
    expect(el.className).toContain('text-mark-foreground');
  });
  it('TextLink renders an anchor with the href', () => {
    render(<TextLink href="/jobs">Jobs</TextLink>);
    const el = screen.getByRole('link', { name: 'Jobs' });
    expect(el.getAttribute('href')).toBe('/jobs');
    expect(el.className).toContain('text-brand');
  });
});
