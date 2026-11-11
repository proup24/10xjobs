import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobAnswers } from '@/lib/setup/answers';
import { JobForm } from './job-form';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LISTS = {
  positions: [
    { value: 'backend_engineer', label: 'Backend engineer' },
    { value: 'frontend_engineer', label: 'Frontend engineer' },
  ],
  seniorities: [
    { value: 'mid', label: 'Mid-level' },
    { value: 'senior', label: 'Senior' },
  ],
  techs: [
    { value: 'postgresql', label: 'PostgreSQL', searchable: true },
    { value: 'react', label: 'React', searchable: true },
    { value: 'saas', label: 'SaaS', searchable: false },
  ],
  languages: [
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'French' },
  ],
};

const SAVED: JobAnswers = {
  position: 'backend_engineer',
  yearsOfExperience: 6,
  seniorities: ['senior'],
  techs: [{ code: 'postgresql', rating: 4 }],
  languages: [{ lang: 'en', level: 'fluent' }],
};

function setup(
  initial: JobAnswers | null = null,
  onSave = vi.fn().mockResolvedValue({ status: 'saved' }),
) {
  const onSaved = vi.fn();
  const onDirtyChange = vi.fn();
  render(
    <JobForm
      formId="f"
      onDirtyChange={onDirtyChange}
      initial={initial}
      lists={LISTS}
      onSave={onSave}
      onSaved={onSaved}
    />,
  );
  return { onSave, onSaved, onDirtyChange };
}

// Base UI opens the list only for typed input, so send what a keyboard sends.
function type(input: HTMLElement, text: string) {
  fireEvent.focus(input);
  fireEvent.input(input, { target: { value: text }, inputType: 'insertText' });
}

async function pick(name: string, text: string, label: string) {
  type(screen.getByRole('combobox', { name }), text);
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

/** The text of every element the control's aria-describedby points at. */
function describedBy(el: HTMLElement): string {
  return (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ');
}

const submit = () =>
  fireEvent.submit(document.querySelector('form#f') as HTMLFormElement);

const STACK_COPY =
  "Add every tech you'd be happy to work with; jobs that need something not on this list are skipped.";

describe('JobForm', () => {
  it('the stack description is the exact copy', () => {
    setup();
    expect(screen.getByText(STACK_COPY)).toBeTruthy();
  });

  it('picking a tech adds an unrated row', async () => {
    setup();
    await pick('Add a tech', 'postg', 'PostgreSQL');
    const group = await screen.findByRole('radiogroup', {
      name: 'PostgreSQL mastery',
    });
    const checked = group.querySelectorAll(
      '[role="radio"][aria-checked="true"]',
    );
    expect(checked.length).toBe(0);
    expect(
      screen.getByRole('button', { name: 'Remove PostgreSQL' }),
    ).toBeTruthy();
  });

  it('a picked tech is not offered again', async () => {
    setup(SAVED);
    type(screen.getByRole('combobox', { name: 'Add a tech' }), 'r');
    await screen.findByRole('option', { name: 'React' });
    expect(screen.queryByRole('option', { name: 'PostgreSQL' })).toBeNull();
  });

  it('continue with an unrated tech shows "Rate PostgreSQL"', async () => {
    const { onSave } = setup({
      ...SAVED,
      techs: [{ code: 'postgresql', rating: null }],
    });
    submit();
    expect(await screen.findByText('Rate PostgreSQL')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('only concept techs shows "Add at least one tech we can search for"', async () => {
    const { onSave } = setup({
      ...SAVED,
      techs: [{ code: 'saas', rating: 3 }],
    });
    submit();
    expect(
      await screen.findByText('Add at least one tech we can search for'),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a language appears once', async () => {
    setup();
    await pick('Add a language', 'eng', 'English');
    expect(
      await screen.findByRole('button', { name: 'Remove English' }),
    ).toBeTruthy();
    type(screen.getByRole('combobox', { name: 'Add a language' }), 'e');
    await screen.findByRole('option', { name: 'French' });
    expect(screen.queryByRole('option', { name: 'English' })).toBeNull();
  });

  it('a new language row has no level, and Continue asks for one', async () => {
    const { onSave } = setup({ ...SAVED, languages: [] });
    await pick('Add a language', 'fre', 'French');
    const level = await screen.findByRole('combobox', {
      name: 'French level',
    });
    expect(level.textContent).not.toMatch(/Native|Fluent|Working/);
    submit();
    expect(await screen.findByText('Pick a level for French')).toBeTruthy();
    expect(level.getAttribute('aria-invalid')).toBe('true');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('picking a level lets the new language save with it', async () => {
    const { onSave } = setup({ ...SAVED, languages: [] });
    await pick('Add a language', 'fre', 'French');
    fireEvent.click(
      await screen.findByRole('combobox', { name: 'French level' }),
    );
    // Base UI commits a mouse pick only when the press started on the item.
    const working = await screen.findByRole('option', { name: 'Working' });
    fireEvent.pointerDown(working, { pointerType: 'mouse' });
    fireEvent.click(working);
    submit();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].languages).toEqual([
      { lang: 'fr', level: 'working' },
    ]);
  });

  it('an empty form asks for each required answer', async () => {
    const { onSave } = setup();
    submit();
    expect(await screen.findByText('Pick a position')).toBeTruthy();
    expect(screen.getByText('Enter your years of experience')).toBeTruthy();
    expect(screen.getByText('Pick at least one seniority')).toBeTruthy();
    expect(screen.getByText('Add at least one language')).toBeTruthy();
    const senior = screen.getByRole('checkbox', { name: 'Senior' });
    expect(senior.getAttribute('aria-invalid')).toBe('true');
    expect(senior.getAttribute('aria-required')).toBe('true');
    expect(describedBy(senior)).toContain('Pick at least one seniority');
    const group = screen.getByRole('group', { name: 'Seniority' });
    expect(
      group.querySelector(':scope > legend [data-slot="field-required"]'),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a saved answer goes through unchanged', async () => {
    const { onSave, onSaved } = setup(SAVED);
    expect(
      (
        screen.getByRole('checkbox', { name: 'Senior' }) as HTMLElement
      ).getAttribute('aria-checked'),
    ).toBe('true');
    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(SAVED);
  });

  it('ticking a seniority and editing years are saved', async () => {
    const { onSave } = setup({ ...SAVED, seniorities: [] });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mid-level' }));
    fireEvent.change(
      screen.getByRole('spinbutton', { name: /Years of experience/ }),
      {
        target: { value: '3' },
      },
    );
    submit();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      seniorities: ['mid'],
      yearsOfExperience: 3,
    });
  });

  it('a server error shows on its field; a failure toasts', async () => {
    const onSave = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'invalid',
        errors: { position: 'Pick a position we know' },
      })
      .mockResolvedValueOnce({ status: 'failed' });
    const { onSaved } = setup(SAVED, onSave);
    submit();
    expect(await screen.findByText('Pick a position we know')).toBeTruthy();
    submit();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('reports unsaved edits and clears after a save', async () => {
    const { onDirtyChange } = setup(SAVED);
    fireEvent.change(
      screen.getByRole('spinbutton', { name: /Years of experience/ }),
      { target: { value: '7' } },
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    submit();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });
});
