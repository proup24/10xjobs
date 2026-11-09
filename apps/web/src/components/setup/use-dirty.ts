import { useRef, useState } from 'react';

/**
 * Whether `values` differ from the baseline taken on first render. `markClean`
 * makes the current values the new baseline (call it after a save).
 */
export function useDirty(values: unknown): {
  dirty: boolean;
  markClean: () => void;
} {
  const current = JSON.stringify(values);
  const [baseline, setBaseline] = useState(current);
  const latest = useRef(current);
  latest.current = current;
  return {
    dirty: current !== baseline,
    markClean: () => setBaseline(latest.current),
  };
}
