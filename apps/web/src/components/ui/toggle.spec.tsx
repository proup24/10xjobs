import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Toggle } from './toggle';
import { ToggleGroup, ToggleGroupItem } from './toggle-group';

afterEach(cleanup);

describe('Toggle', () => {
  it('toggle exposes aria-pressed and flips on click', () => {
    const onPressedChange = vi.fn();
    render(
      <Toggle aria-label="Search for this" onPressedChange={onPressedChange} />,
    );
    const button = screen.getByRole('button', { name: 'Search for this' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(onPressedChange.mock.calls[0][0]).toBe(true);
  });

  it('disabled toggle ignores clicks', () => {
    const onPressedChange = vi.fn();
    render(
      <Toggle aria-label="Star" disabled onPressedChange={onPressedChange} />,
    );
    const button = screen.getByRole('button', { name: 'Star' });
    fireEvent.click(button);
    expect(onPressedChange).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('ToggleGroup', () => {
  it('toggle group in multiple mode reports every pressed value', () => {
    const onValueChange = vi.fn();
    render(
      <ToggleGroup multiple defaultValue={[]} onValueChange={onValueChange}>
        <ToggleGroupItem value="remote">Remote</ToggleGroupItem>
        <ToggleGroupItem value="hybrid">Hybrid</ToggleGroupItem>
        <ToggleGroupItem value="onsite" disabled>
          On-site
        </ToggleGroupItem>
      </ToggleGroup>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remote' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hybrid' }));
    fireEvent.click(screen.getByRole('button', { name: 'On-site' }));
    expect(onValueChange).toHaveBeenCalledTimes(2);
    expect(onValueChange.mock.calls[1][0]).toEqual(['remote', 'hybrid']);
  });
});
