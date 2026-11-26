/** Bump when the check or the word list changes, so stored skips can be told apart. */
export const PREFILTER_VERSION = 1;
/** How far back first-seen skipped jobs are rechecked when profiles change. */
export const RECHECK_WINDOW_MS = 24 * 60 * 60 * 1000;
