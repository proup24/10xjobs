/** Bump when the check or the word list changes, so stored skips can be told apart. */
export const PREFILTER_VERSION = 1;
/** How far back first-seen skipped jobs are rechecked when profiles change. */
export const RECHECK_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * How far before a tick a recheck may reach, however old the profile's change
 * time looks (the web app's edits do not always bump `updatedAt`).
 */
export const RECHECK_MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
