import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDirty } from './use-dirty';

describe('useDirty', () => {
  it('is not dirty on mount', () => {
    const { result } = renderHook(() => useDirty({ a: 1 }));
    expect(result.current.dirty).toBe(false);
  });

  it('is dirty after the values change, clean when they return', () => {
    const { result, rerender } = renderHook(({ v }) => useDirty(v), {
      initialProps: { v: { a: 1 } },
    });
    rerender({ v: { a: 2 } });
    expect(result.current.dirty).toBe(true);
    rerender({ v: { a: 1 } });
    expect(result.current.dirty).toBe(false);
  });

  it('markClean(snapshot) keeps edits made after the snapshot dirty', () => {
    const { result, rerender } = renderHook(({ v }) => useDirty(v), {
      initialProps: { v: { a: 1 } },
    });
    rerender({ v: { a: 2 } });
    const submitted = result.current.snapshot;
    rerender({ v: { a: 3 } }); // typed while the save is pending
    act(() => result.current.markClean(submitted));
    expect(result.current.dirty).toBe(true);
    rerender({ v: { a: 2 } });
    expect(result.current.dirty).toBe(false);
  });

  it('markClean makes the current values the baseline', () => {
    const { result, rerender } = renderHook(({ v }) => useDirty(v), {
      initialProps: { v: { a: 1 } },
    });
    rerender({ v: { a: 2 } });
    act(() => result.current.markClean());
    expect(result.current.dirty).toBe(false);
    rerender({ v: { a: 1 } });
    expect(result.current.dirty).toBe(true);
  });
});
