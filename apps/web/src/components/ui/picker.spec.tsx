import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field, FieldError, FieldLabel } from './field';
import { MultiPicker, Picker } from './picker';
import type { PickerOption } from './picker-filter';

afterEach(cleanup);

const CITIES: PickerOption[] = [
  { value: 'alberta', label: 'Alberta' },
  { value: 'berlin', label: 'Berlin' },
  { value: 'zurich', label: 'Zürich' },
];

// First portal mounts can be slow on a loaded host.
const PORTAL = { timeout: 3000 };

// Base UI opens the list only for typed input (an InputEvent with
// `inputType`), not for autofill-like changes, so send what a keyboard sends.
function type(input: HTMLElement, text: string) {
  fireEvent.focus(input);
  fireEvent.input(input, { target: { value: text }, inputType: 'insertText' });
}

function optionLabels() {
  return screen.getAllByRole('option').map((option) => option.textContent);
}

describe('MultiPicker', () => {
  function setup(value: string[] = [], onValueChange = vi.fn()) {
    render(
      <MultiPicker
        aria-label="Cities"
        options={CITIES}
        value={value}
        onValueChange={onValueChange}
        placeholder="Add a city"
        emptyText="No city found"
      />,
    );
    return { input: screen.getByRole('combobox'), onValueChange };
  }

  it('typing "ber" and choosing Berlin adds it', async () => {
    const { input, onValueChange } = setup();
    type(input, 'ber');
    await screen.findByRole('option', { name: 'Berlin' }, PORTAL);
    expect(optionLabels()).toEqual(['Berlin', 'Alberta']);
    fireEvent.click(screen.getByRole('option', { name: 'Berlin' }));
    expect(onValueChange).toHaveBeenLastCalledWith(['berlin']);
  });

  it('shows selected values as chips whose remove button removes them', () => {
    const { onValueChange } = setup(['berlin']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Berlin' }));
    expect(onValueChange).toHaveBeenLastCalledWith([]);
  });

  it('Backspace in the empty search removes the last value', () => {
    const { input, onValueChange } = setup(['zurich', 'berlin']);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onValueChange).toHaveBeenLastCalledWith(['zurich']);
  });

  it('does not list selected options again', async () => {
    const { input } = setup(['berlin']);
    type(input, 'ber');
    await screen.findByRole('option', { name: 'Alberta' }, PORTAL);
    expect(optionLabels()).toEqual(['Alberta']);
  });

  it('shows emptyText when nothing matches', async () => {
    const { input } = setup();
    type(input, 'tokyo');
    await screen.findByText('No city found', undefined, PORTAL);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});

describe('Picker', () => {
  function setup(value: string | null = null, onValueChange = vi.fn()) {
    render(
      <Picker
        aria-label="City"
        options={CITIES}
        value={value}
        onValueChange={onValueChange}
        placeholder="Choose a city"
        emptyText="No city found"
      />,
    );
    return { input: screen.getByRole('combobox'), onValueChange };
  }

  it('finds Zürich by typing "zurich" and selects its value', async () => {
    const { input, onValueChange } = setup();
    type(input, 'zurich');
    const option = await screen.findByRole(
      'option',
      { name: 'Zürich' },
      PORTAL,
    );
    expect(optionLabels()).toEqual(['Zürich']);
    fireEvent.click(option);
    expect(onValueChange).toHaveBeenLastCalledWith('zurich');
  });

  it('shows the selected label in the input', () => {
    const { input } = setup('berlin');
    expect((input as HTMLInputElement).value).toBe('Berlin');
  });

  it('shows emptyText when nothing matches', async () => {
    const { input } = setup();
    type(input, 'tokyo');
    await screen.findByText('No city found', undefined, PORTAL);
  });

  it('renders at most 50 of 2,000 options and still finds the last one', async () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({
      value: `option-${i}`,
      label: `Option ${i}`,
    }));
    render(
      <Picker
        aria-label="Many"
        options={many}
        value={null}
        onValueChange={() => undefined}
        placeholder="Pick"
        emptyText="None"
      />,
    );
    const input = screen.getByRole('combobox');
    type(input, 'option');
    await screen.findByRole('option', { name: 'Option 0' }, PORTAL);
    expect(screen.getAllByRole('option')).toHaveLength(50);
    type(input, 'option 1999');
    await screen.findByRole('option', { name: 'Option 1999' }, PORTAL);
    expect(optionLabels()).toEqual(['Option 1999']);
  });

  it('gets aria-invalid and aria-describedby from an invalid Field', () => {
    render(
      <Field invalid>
        <FieldLabel htmlFor="city">City</FieldLabel>
        <Picker
          id="city"
          options={CITIES}
          value={null}
          onValueChange={() => undefined}
          placeholder="Choose a city"
          emptyText="No city found"
        />
        <FieldError>Pick a city</FieldError>
      </Field>,
    );
    const input = screen.getByRole('combobox');
    expect(input.id).toBe('city');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe(
      'Pick a city',
    );
  });
});
