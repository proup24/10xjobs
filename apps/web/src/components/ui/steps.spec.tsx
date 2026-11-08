import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Steps } from './steps';

afterEach(cleanup);

const steps = [
  { id: 'profile', label: 'Profile' },
  { id: 'roles', label: 'Roles' },
  { id: 'places', label: 'Places' },
  { id: 'review', label: 'Review' },
];

describe('Steps', () => {
  it('marks the current step, completes earlier ones and shows the compact form', () => {
    render(<Steps steps={steps} current={1} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[1].getAttribute('aria-current')).toBe('step');
    expect(items[0].getAttribute('aria-current')).toBeNull();
    expect(items[0].textContent?.trim().endsWith('(done)')).toBe(true);
    expect(items[2].textContent).not.toContain('(done)');
    expect(screen.getByText(/Step 2 of 4/)).toBeTruthy();
    expect(screen.getByText(/Step 2 of 4/).textContent).toContain('Roles');
  });

  it('hides the compact form from assistive tech so steps are not read twice', () => {
    render(<Steps steps={steps} current={1} />);
    expect(
      screen.getByText(/Step 2 of 4/).closest('[aria-hidden="true"]'),
    ).toBeTruthy();
  });

  it('clamps an out-of-range current', () => {
    const { rerender } = render(<Steps steps={steps} current={9} />);
    expect(screen.getByText(/Step 4 of 4/)).toBeTruthy();
    rerender(<Steps steps={steps} current={-3} />);
    expect(screen.getByText(/Step 1 of 4/)).toBeTruthy();
    rerender(<Steps steps={steps} current={Number.NaN} />);
    expect(screen.getByText(/Step 1 of 4/)).toBeTruthy();
  });

  it('renders nothing for no steps', () => {
    const { container } = render(<Steps steps={[]} current={0} />);
    expect(container.innerHTML).toBe('');
  });
});
