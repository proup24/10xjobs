import { describe, expect, it } from 'vitest';
import { roleKeys } from './role-key';

describe('roleKeys', () => {
  it('folds case, accents and punctuation and suffixes repeats', () => {
    expect(
      roleKeys([
        'Senior Backend Engineer',
        'Sénior backend engineer!',
        'Frontend Dev',
      ]),
    ).toEqual([
      'senior-backend-engineer',
      'senior-backend-engineer-2',
      'frontend-dev',
    ]);
  });

  it('numbers a third repeat', () => {
    expect(roleKeys(['QA', 'qa', 'QA.'])).toEqual(['qa', 'qa-2', 'qa-3']);
  });

  it('never returns an empty key', () => {
    expect(roleKeys(['工程师', '!!!', ''])).toEqual([
      'role',
      'role-2',
      'role-3',
    ]);
  });

  it('never repeats a key when a title looks like a suffixed key', () => {
    const keys = roleKeys(['QA', 'QA', 'QA 2']);
    expect(new Set(keys).size).toBe(3);
    expect(keys.slice(0, 2)).toEqual(['qa', 'qa-2']);
  });
});
