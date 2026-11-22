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
});
