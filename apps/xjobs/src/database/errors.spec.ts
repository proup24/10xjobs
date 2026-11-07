import { ConflictException } from '@nestjs/common';
import {
  isCheckViolation,
  isUniqueViolation,
  rethrowConflict,
} from './errors';

describe('isUniqueViolation', () => {
  it('is true for a SQLSTATE 23505 error', () => {
    expect(isUniqueViolation({ sqlState: '23505' })).toBe(true);
  });

  it('is true when the violation is a cause further down the chain', () => {
    const error = new Error('query failed', { cause: { sqlState: '23505' } });
    expect(isUniqueViolation(error)).toBe(true);
  });

  it('is false for a foreign-key violation', () => {
    expect(isUniqueViolation({ sqlState: '23503' })).toBe(false);
  });

  it('is false for null', () => {
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('isCheckViolation', () => {
  it('is true for a SQLSTATE 23514 error', () => {
    expect(isCheckViolation({ sqlState: '23514' })).toBe(true);
  });

  it('is false for a unique violation', () => {
    expect(isCheckViolation({ sqlState: '23505' })).toBe(false);
  });

  it('is true when the violation is a cause further down the chain', () => {
    const error = new Error('x', { cause: { sqlState: '23514' } });
    expect(isCheckViolation(error)).toBe(true);
  });

  it('is false for null', () => {
    expect(isCheckViolation(null)).toBe(false);
  });
});

describe('rethrowConflict', () => {
  it('throws ConflictException for a unique violation', () => {
    expect(() => rethrowConflict({ sqlState: '23505' }, 'taken')).toThrow(
      new ConflictException('taken'),
    );
  });

  it('rethrows any other error unchanged', () => {
    const error = { sqlState: '23503' };
    try {
      rethrowConflict(error, 'taken');
    } catch (thrown) {
      expect(thrown).toBe(error);
      return;
    }
    throw new Error('expected rethrowConflict to throw');
  });
});
