import { BadRequestException } from '@nestjs/common';
import { Position, Seniority, SkillDomain, Technology } from 'src/common/enums';
import type { QuerySearchProfileInput } from '../types';
import { assertHasSkills, hasRankedSkill, SKILLS_REQUIRED } from './skills';

const input: QuerySearchProfileInput = {
  position: Position.backend_engineer,
  locations: { remote: ['EMEA'], hybrid: [], onsite: [] },
  seniorities: [Seniority.senior],
  skills: [],
};
const go = (importance: number) => ({
  technology: Technology.go,
  domain: SkillDomain.backend,
  importance,
  mastery: 5,
});

describe('hasRankedSkill', () => {
  it('is false for an empty tech stack', () => {
    expect(hasRankedSkill([])).toBe(false);
  });

  it('is false when every skill has importance 0', () => {
    expect(hasRankedSkill([go(0)])).toBe(false);
  });

  it('is true with one skill above 0', () => {
    expect(hasRankedSkill([go(0), go(1)])).toBe(true);
  });
});

describe('assertHasSkills', () => {
  it('throws a 400 with the skills message', () => {
    expect(() => assertHasSkills(input)).toThrow(BadRequestException);
    expect(() => assertHasSkills(input)).toThrow(SKILLS_REQUIRED);
  });

  it('passes with a ranked skill', () => {
    expect(() => assertHasSkills({ ...input, skills: [go(3)] })).not.toThrow();
  });
});
