import { describe, expect, it } from 'vitest';
import { seedOptions } from './options.testing';
import { buildDecisionQuestions } from './questions';

describe('buildDecisionQuestions', () => {
  const options = seedOptions();
  const questions = buildDecisionQuestions(options);

  it('lists the keys in spec order', () => {
    const keys = questions.map((q) => q.key);
    expect(keys.slice(0, 6)).toEqual([
      'arrangement',
      'seniority',
      'roleKind',
      'contractType',
      'engagement',
      'isSoftwareEngineeringRole',
    ]);
    expect(keys.at(-1)).toBe('sponsorshipOffered');
  });

  it('takes choice options from the approved lists', () => {
    const seniority = questions.find((q) => q.key === 'seniority');
    expect(seniority?.kind).toBe('choice');
    if (seniority?.kind === 'choice')
      expect(seniority.options).toEqual(options.seniorities);
    const roleKind = questions.find((q) => q.key === 'roleKind');
    if (roleKind?.kind === 'choice')
      expect(roleKind.options).toEqual(options.roleKinds);
  });

  it('asks one junk yes/no per junk flag', () => {
    const junk = questions.filter((q) => q.key.startsWith('junk:'));
    expect(junk.map((q) => q.key)).toEqual(
      options.junkFlags.map((c) => `junk:${c}`),
    );
    expect(junk.every((q) => q.kind === 'yesno')).toBe(true);
  });

  it('offers yes, no, unstated for sponsorship', () => {
    const q = questions.find((x) => x.key === 'sponsorshipOffered');
    expect(q?.kind).toBe('choice');
    if (q?.kind === 'choice')
      expect(q.options).toEqual(['yes', 'no', 'unstated']);
  });

  it('gives every question a short instruction', () => {
    for (const q of questions)
      expect(q.instructions.length).toBeGreaterThan(10);
  });
});
