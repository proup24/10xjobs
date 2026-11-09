import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimezoneFields } from './timezone-fields';

afterEach(cleanup);

const VALUE = { current: 60, min: -120, max: 240 };

// Base UI commits a mouse pick only when the press started on the item.
async function choose(trigger: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: trigger }));
  const item = await screen.findByRole('option', { name: option });
  fireEvent.pointerDown(item, { pointerType: 'mouse' });
  fireEvent.click(item);
}

describe('TimezoneFields', () => {
  it('shows each offset as UTC±h', () => {
    render(<TimezoneFields value={VALUE} onChange={vi.fn()} />);
    expect(
      screen.getByRole('combobox', { name: 'Your UTC offset' }).textContent,
    ).toContain('UTC+1');
    expect(
      screen.getByRole('combobox', { name: 'From' }).textContent,
    ).toContain('UTC−2');
    expect(screen.getByRole('combobox', { name: 'To' }).textContent).toContain(
      'UTC+4',
    );
  });

  it('offers the half-hour offsets and reports a change in minutes', async () => {
    const onChange = vi.fn();
    render(<TimezoneFields value={VALUE} onChange={onChange} />);
    await choose('To', 'UTC+5:30');
    expect(onChange).toHaveBeenCalledWith({ ...VALUE, max: 330 });
  });

  it('shows a range error on the range', () => {
    render(
      <TimezoneFields
        value={VALUE}
        onChange={vi.fn()}
        errors={{ timezoneMax: 'End the range at or after its start' }}
      />,
    );
    expect(
      screen.getByText('End the range at or after its start'),
    ).toBeTruthy();
    expect(
      screen.getByRole('combobox', { name: 'To' }).getAttribute('aria-invalid'),
    ).toBe('true');
  });
});
