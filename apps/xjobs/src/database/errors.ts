import { ConflictException } from '@nestjs/common';

/** Postgres SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';
/** Postgres SQLSTATE for a check violation, which the code-check triggers raise too. */
const CHECK_VIOLATION = '23514';

/** The first error in `error`'s `cause` chain whose SQLSTATE is `state`, or null. */
function findSqlState(error: unknown, state: string): object | null {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current; depth++) {
    if (typeof current !== 'object') return null;
    if ((current as { sqlState?: unknown }).sqlState === state) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * @description True when `error`, or any error in its `cause` chain, is a
 * Postgres unique violation. Driver errors carry `sqlState`; middleware may
 * wrap them, so the chain is walked.
 */
export function isUniqueViolation(error: unknown): boolean {
  return findSqlState(error, UNIQUE_VIOLATION) !== null;
}

/**
 * @description True when `error`, or any error in its `cause` chain, is a
 * Postgres check violation: a check constraint, or a code-check trigger
 * refusing a value outside its list.
 */
export function isCheckViolation(error: unknown): boolean {
  return findSqlState(error, CHECK_VIOLATION) !== null;
}

/**
 * @description The message of the check violation in `error`'s `cause` chain,
 * such as `profiles.position: 'support' is not an approved role_kinds code`;
 * null when there is none.
 */
export function checkViolationMessage(error: unknown): string | null {
  const violation = findSqlState(error, CHECK_VIOLATION);
  if (!violation) return null;
  const message = (violation as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}

/** SQLSTATEs where re-running the whole transaction can succeed. */
const RETRYABLE_TRANSACTION_STATES = new Set([
  UNIQUE_VIOLATION,
  '40001', // serialization_failure
  '40P01', // deadlock_detected
]);

/**
 * @description True when `error`, or any error in its `cause` chain, is a
 * uniqueness race, serialization failure or deadlock: re-running the complete
 * transaction is safe and may succeed.
 */
export function isRetryableTransactionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current; depth++) {
    if (typeof current !== 'object') return false;
    const state = (current as { sqlState?: unknown }).sqlState;
    if (typeof state === 'string' && RETRYABLE_TRANSACTION_STATES.has(state)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Turns a unique violation into a 409 with `message`; rethrows anything else. */
export function rethrowConflict(error: unknown, message: string): never {
  if (isUniqueViolation(error)) throw new ConflictException(message);
  throw error;
}
