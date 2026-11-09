import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TechAnswer } from '@/lib/setup/answers';
import { TechRows } from './tech-rows';

afterEach(cleanup);

const OPTIONS = [
  { value: 'postgresql', label: 'PostgreSQL', searchable: true },
  { value: 'react', label: 'React', searchable: true },
  { value: 'typescript', label: 'TypeScript', searchable: true },
  { value: 'saas', label: 'SaaS', searchable: false },
];

const tech = (code: string, patch: Partial<TechAnswer> = {}): TechAnswer => ({
  code,
  rating: 3,
  ...patch,
});

function setup(value: TechAnswer[], errors: Record<string, string> = {}) {
  const onChange = vi.fn();
  render(
    <TechRows
      value={value}
      onChange={onChange}
      options={OPTIONS}
      errors={errors}
    />,
  );
  return { onChange };
}

describe('TechRows', () => {
  it('shows each tech by label with its rating ends and a remove button', () => {
    const { onChange } = setup([tech('postgresql')]);
    expect(screen.getByText('PostgreSQL')).toBeTruthy();
    expect(screen.getByText('1 = learning')).toBeTruthy();
    expect(screen.getByText('5 = expert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove PostgreSQL' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('rating a tech reports the rating', () => {
    const { onChange } = setup([tech('postgresql', { rating: null })]);
    const group = screen.getByRole('radiogroup', {
      name: 'PostgreSQL mastery',
    });
    fireEvent.click(
      Array.from(group.querySelectorAll('[role="radio"]'))[3] as HTMLElement,
    );
    expect(onChange).toHaveBeenCalledWith([tech('postgresql', { rating: 4 })]);
  });

  it('has no search star on any tech', () => {
    setup([tech('postgresql'), tech('saas')]);
    expect(screen.queryByRole('button', { name: /search for/i })).toBeNull();
  });

  it('a rating error is shown on its row', () => {
    setup([tech('postgresql', { rating: null })], {
      'techs.0.rating': 'Rate PostgreSQL',
    });
    expect(screen.getByText('Rate PostgreSQL')).toBeTruthy();
    expect(
      screen
        .getByRole('radiogroup', { name: 'PostgreSQL mastery' })
        .getAttribute('aria-invalid'),
    ).toBe('true');
  });
});
