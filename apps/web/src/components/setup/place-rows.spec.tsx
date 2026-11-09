import { useState } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaceRow } from '@/lib/setup/answers';
import { PlaceRows, placeOptions } from './place-rows';

afterEach(cleanup);

const PARIS = '0b8f5c1e-1d2a-4c3b-9e4f-5a6b7c8d9e0f';

const OPTIONS = placeOptions({
  regions: [{ value: 'WEU', label: 'Western Europe' }],
  countries: [
    { value: 'FR', label: 'France' },
    { value: 'DE', label: 'Germany' },
  ],
  cities: [{ value: PARIS, label: 'Paris, France' }],
});

function Harness({
  initial = [],
  onChange,
}: {
  initial?: PlaceRow[];
  onChange?: (rows: PlaceRow[]) => void;
}) {
  const [rows, setRows] = useState<PlaceRow[]>(initial);
  return (
    <PlaceRows
      value={rows}
      onChange={(next) => {
        setRows(next);
        onChange?.(next);
      }}
      options={OPTIONS}
    />
  );
}

function type(input: HTMLElement, text: string) {
  fireEvent.focus(input);
  fireEvent.input(input, { target: { value: text }, inputType: 'insertText' });
}

const addPlace = () => screen.getByRole('combobox', { name: 'Add a place' });

const WORLDWIDE_REMOTE: PlaceRow = {
  place: { kind: 'worldwide' },
  remote: true,
  hybrid: false,
  onsite: false,
};

describe('PlaceRows', () => {
  it('Worldwide is the first option and its row allows only Remote', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    type(addPlace(), 'w');
    const options = await screen.findAllByRole('option');
    expect(options[0].textContent).toContain('Worldwide');
    fireEvent.click(options[0]);
    expect(onChange).toHaveBeenLastCalledWith([WORLDWIDE_REMOTE]);
    const group = screen.getByRole('group', { name: 'Worldwide arrangements' });
    const remote = within(group).getByRole('button', { name: 'Remote' });
    expect(remote.getAttribute('aria-pressed')).toBe('true');
    for (const name of ['Hybrid', 'On-site']) {
      const button = within(group).getByRole('button', { name });
      expect(button.hasAttribute('disabled')).toBe(true);
    }
  });

  it('each result is labelled with its kind', async () => {
    render(<Harness />);
    type(addPlace(), 'fr');
    const france = await screen.findByRole('option', { name: /^France/ });
    expect(france.textContent).toContain('Country');
    const paris = screen.getByRole('option', { name: /^Paris, France/ });
    expect(paris.textContent).toContain('City');
  });

  it('a picked place is a row with its kind badge, no arrangement and a remove button', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    type(addPlace(), 'germ');
    fireEvent.click(await screen.findByRole('option', { name: /^Germany/ }));
    expect(onChange).toHaveBeenLastCalledWith([
      {
        place: { kind: 'country', code: 'DE' },
        remote: false,
        hybrid: false,
        onsite: false,
      },
    ]);
    expect(screen.getByText('Country')).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Germany arrangements' });
    fireEvent.click(within(group).getByRole('button', { name: 'Hybrid' }));
    expect(onChange).toHaveBeenLastCalledWith([
      {
        place: { kind: 'country', code: 'DE' },
        remote: false,
        hybrid: true,
        onsite: false,
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Germany' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('a picked place is not offered again', async () => {
    render(<Harness initial={[WORLDWIDE_REMOTE]} />);
    type(addPlace(), 'w');
    await screen.findByRole('option', { name: /^Western Europe/ });
    expect(screen.queryByRole('option', { name: /^Worldwide/ })).toBeNull();
  });

  it('a remote place under worldwide remote shows a hint', () => {
    render(
      <Harness
        initial={[
          WORLDWIDE_REMOTE,
          {
            place: { kind: 'country', code: 'FR' },
            remote: true,
            hybrid: false,
            onsite: false,
          },
          {
            place: { kind: 'country', code: 'DE' },
            remote: false,
            hybrid: true,
            onsite: false,
          },
        ]}
      />,
    );
    expect(
      screen.getAllByText('Worldwide remote already covers remote here.'),
    ).toHaveLength(1);
  });
});
