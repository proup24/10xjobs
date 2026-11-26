/**
 * Bump on any change to how facts are combined, including a `franc` upgrade or a change to the
 * posting-language thresholds, or a change to how requirements are derived from no
 * sponsorship. Stored with each `job_facts` row.
 */
export const FACTS_VERSION = 8;

/**
 * Extractions made from this time on read person-binding lines ("candidates must be based
 * in") as `limit` and job or team location lines as `label`; older ones were not reprocessed
 * and still store some person-binding lines as `label`. Facts record which reading theirs had
 * (`limitsBindPerson`), so the residence check binds on `label` only for older ones.
 */
export const LIMITS_BIND_PERSON_SINCE = new Date('2026-11-20T14:50:00Z');
