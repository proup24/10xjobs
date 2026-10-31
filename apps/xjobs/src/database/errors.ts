import { ConflictException } from '@nestjs/common';

/** Postgres SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * @description True when `error`, or any error in its `cause` chain, is a
 * Postgres unique violation. Driver errors carry `sqlState`; middleware may
 * wrap them, so the chain is walked.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current; depth++) {
    if (typeof current !== 'object') return false;
    if ((current as { sqlState?: unknown }).sqlState === UNIQUE_VIOLATION) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
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
