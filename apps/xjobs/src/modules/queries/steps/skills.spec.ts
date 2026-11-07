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

  it('is false when no skill above 0 has search wording (saas, microservices)', () => {
    expect(
      hasRankedSkill([
        { ...go(10), technology: 'saas' },
        { ...go(9), technology: 'microservices' },
      ]),
    ).toBe(false);
  });
});

describe('assertHasSkills', () => {
  it('throws a 400 with the skills message', () => {
    expect(() => assertHasSkills(input)).toThrow(BadRequestException);
    expect(() => assertHasSkills(input)).toThrow(SKILLS_REQUIRED);
  });

  it('throws a 400 when the only skills are concept tags (saas, microservices)', () => {
    const conceptsOnly = {
      ...input,
      skills: [
        { ...go(10), technology: 'saas' },
        { ...go(9), technology: 'microservices' },
      ],
    };
    expect(() => assertHasSkills(conceptsOnly)).toThrow(
      new BadRequestException(SKILLS_REQUIRED),
    );
  });

  it('passes with a ranked skill', () => {
    expect(() => assertHasSkills({ ...input, skills: [go(3)] })).not.toThrow();
  });
});
