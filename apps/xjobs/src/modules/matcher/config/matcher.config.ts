/** Bump when a rule changes, so stored decisions can be told apart. */
export const MATCHER_VERSION = 12;
/** The oldest an original post may be, in days, before a role from it fails. */
export const POST_MAX_AGE_DAYS = 30;
/**
 * How long after an original turns POST_MAX_AGE_DAYS old its role rows are re-decided.
 * The decision reads the engine clock and the row's `updatedAt` is the database's, a
 * little later: a row decided just before the mark but written just after it must still
 * be re-decided once, so the mark the sweep compares with is moved by this margin.
 */
export const POST_AGE_STALE_MARGIN_MINUTES = 5;
/** Years above the profile's experience that a job may ask before it fails. */
export const SENIORITY_YEARS_MARGIN = 2;
/** The lowest stack score that still qualifies. */
export const MIN_STACK_SCORE = 0.4;
/** How far back a newly published profile is matched against jobs. */
export const MATCH_BACKFILL_DAYS = 30;
export const MATCH_SWEEP = { everyMs: 60_000, limit: 200 };
/** Standard working hours, used to move a pay between periods. */
export const HOURS_PER_YEAR = 2080;
export const HOURS_PER_DAY = 8;
export const MONTHS_PER_YEAR = 12;
/** How far below the profile's minimum a pay may fall before it fails: absorbs rate and rounding noise. */
export const SALARY_MARGIN = 0.1;
