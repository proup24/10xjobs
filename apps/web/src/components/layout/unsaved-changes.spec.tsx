import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider, useUnsavedChanges } from './unsaved-changes';

afterEach(cleanup);

function Probe({ go }: { go: () => void }) {
  const { setDirty, confirmLeave } = useUnsavedChanges();
  return (
    <>
      <button onClick={() => setDirty(true)}>dirty</button>
      <button onClick={() => setDirty(false)}>clean</button>
      <button onClick={() => confirmLeave(go)}>leave</button>
    </>
  );
}

const setup = () => {
  const go = vi.fn();
  render(
    <UnsavedChangesProvider>
      <Probe go={go} />
    </UnsavedChangesProvider>,
  );
  return go;
};

const click = (name: string) =>
  act(() => {
    fireEvent.click(screen.getByRole('button', { name }));
  });

const unload = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
};

describe('UnsavedChangesProvider', () => {
  it('runs go at once when clean, with no dialog', () => {
    const go = setup();
    click('leave');
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Discard changes?')).toBeNull();
  });

  it('asks first when dirty and does not run go yet', () => {
    const go = setup();
    click('dirty');
    click('leave');
    expect(screen.getByText('Discard changes?')).toBeTruthy();
    expect(
      screen.getByText("Your changes on this page haven't been saved."),
    ).toBeTruthy();
    expect(go).not.toHaveBeenCalled();
  });

  it('Keep editing closes the dialog without running go', async () => {
    const go = setup();
    click('dirty');
    click('leave');
    click('Keep editing');
    expect(go).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(screen.queryByText('Discard changes?')).toBeNull(),
    );
  });

  it('Discard runs go and clears the dirty flag', () => {
    const go = setup();
    click('dirty');
    click('leave');
    click('Discard');
    expect(go).toHaveBeenCalledTimes(1);
    expect(unload().defaultPrevented).toBe(false);
  });

  it('blocks beforeunload only while dirty', () => {
    setup();
    expect(unload().defaultPrevented).toBe(false);
    click('dirty');
    // jsdom's Event.returnValue is a boolean, so catch the assignment.
    const event = new Event('beforeunload', { cancelable: true });
    const assigned: unknown[] = [];
    Object.defineProperty(event, 'returnValue', {
      set: (v) => assigned.push(v),
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(assigned).toEqual(['']);
    click('clean');
    expect(unload().defaultPrevented).toBe(false);
  });

  it('removes the beforeunload listener on unmount', () => {
    const go = vi.fn();
    const { unmount } = render(
      <UnsavedChangesProvider>
        <Probe go={go} />
      </UnsavedChangesProvider>,
    );
    click('dirty');
    unmount();
    expect(unload().defaultPrevented).toBe(false);
  });

  it('keeps setDirty the same function across renders', () => {
    const seen: unknown[] = [];
    function Capture() {
      seen.push(useUnsavedChanges().setDirty);
      return null;
    }
    const { rerender } = render(
      <UnsavedChangesProvider>
        <Capture />
        <Probe go={() => undefined} />
      </UnsavedChangesProvider>,
    );
    click('dirty');
    rerender(
      <UnsavedChangesProvider>
        <Capture />
        <Probe go={() => undefined} />
      </UnsavedChangesProvider>,
    );
    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(1);
  });

  it('throws when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe go={() => undefined} />)).toThrow(
      /UnsavedChangesProvider/,
    );
    spy.mockRestore();
  });
});
