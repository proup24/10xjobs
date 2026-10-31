import { SkillDomain, Technology } from 'src/common/enums';
import type { RankedSkill } from '../types';
import { technologySets, topTechnologies } from './technology';

const skill = (
  technology: Technology,
  importance: number,
  mastery: number,
  domain: SkillDomain = SkillDomain.backend,
): RankedSkill => ({ technology, importance, mastery, domain });

describe('topTechnologies', () => {
  it('orders by importance, then mastery', () => {
    expect(
      topTechnologies([
        skill(Technology.go, 5, 9),
        skill(Technology.rust, 8, 5),
        skill(Technology.nestjs, 8, 5),
      ]),
    ).toEqual([Technology.nestjs, Technology.rust]);
  });

  it('breaks full ties by technology name', () => {
    expect(
      topTechnologies([
        skill(Technology.rust, 5, 5),
        skill(Technology.go, 5, 5),
      ]),
    ).toEqual([Technology.go, Technology.rust]);
  });

  it('drops importance 0', () => {
    expect(
      topTechnologies([
        skill(Technology.go, 0, 9),
        skill(Technology.rust, 1, 0),
      ]),
    ).toEqual([Technology.rust]);
  });

  it('counts a technology under two domains once, at its highest rank', () => {
    expect(
      topTechnologies([
        skill(Technology.go, 3, 9),
        skill(Technology.rust, 5, 5),
        skill(Technology.go, 8, 1),
      ]),
    ).toEqual([Technology.go, Technology.rust]);
  });

  it('keeps only the top 2 of 5', () => {
    expect(
      topTechnologies([
        skill(Technology.go, 1, 5),
        skill(Technology.rust, 2, 5),
        skill(Technology.nestjs, 3, 5),
        skill(Technology.react, 4, 5),
        skill(Technology.postgresql, 5, 5),
      ]),
    ).toEqual([Technology.postgresql, Technology.react]);
  });
});

describe('technologySets', () => {
  const [a, b, c] = [Technology.go, Technology.rust, Technology.nestjs];
  const skills = [
    skill(a, 9, 5, SkillDomain.backend),
    skill(b, 8, 5, SkillDomain.devops),
    skill(c, 7, 5),
  ];

  it('returns one set per top technology, with its domain', () => {
    expect(technologySets(skills)).toEqual([
      { technologies: [a], domain: SkillDomain.backend },
      { technologies: [b], domain: SkillDomain.devops },
    ]);
  });

  it('returns 1 set for 1 technology', () => {
    expect(technologySets(skills.slice(0, 1))).toEqual([
      { technologies: [a], domain: SkillDomain.backend },
    ]);
  });

  it('takes the domain of the best-ranked entry of a technology', () => {
    expect(
      technologySets([
        skill(a, 3, 9, SkillDomain.devops),
        skill(a, 8, 1, SkillDomain.backend),
      ]),
    ).toEqual([{ technologies: [a], domain: SkillDomain.backend }]);
  });

  it('returns no sets without a ranked skill', () => {
    expect(technologySets([])).toEqual([]);
    expect(technologySets([skill(a, 0, 9)])).toEqual([]);
  });
});
