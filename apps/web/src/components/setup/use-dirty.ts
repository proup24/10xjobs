import { useRef, useState } from 'react';

/**
 * Whether `values` differ from the baseline taken on first render. `markClean`
 * makes `snapshot` (default: the current values) the new baseline. After a save pass the `snapshot` from submit time, so edits made while saving stay dirty.
 */
export function useDirty(values: unknown): {
  dirty: boolean;
  /** The values now, as a string: capture it at submit and pass it to `markClean`. */
  snapshot: string;
  markClean: (snapshot?: string) => void;
} {
  const current = JSON.stringify(values);
  const [baseline, setBaseline] = useState(current);
  const latest = useRef(current);
  latest.current = current;
  return {
    dirty: current !== baseline,
    snapshot: current,
    markClean: (snapshot) => setBaseline(snapshot ?? latest.current),
  };
}
