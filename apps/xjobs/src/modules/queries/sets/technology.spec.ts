import { SkillDomain } from 'src/common/enums';
import type { RankedSkill } from '../types';
import { technologySets, topTechnologies } from './technology';

const skill = (
  technology: string,
  importance: number,
  mastery = 5,
  domain: SkillDomain = SkillDomain.backend,
): RankedSkill => ({ technology, importance, mastery, domain });

describe('topTechnologies', () => {
  it('orders by importance, then mastery', () => {
    expect(
      topTechnologies([
        skill('go', 5, 9),
        skill('rust', 8, 5),
        skill('nestjs', 8, 5),
      ]),
    ).toEqual(['nestjs', 'rust']);
  });

  it('breaks full ties by technology name', () => {
    expect(topTechnologies([skill('rust', 5, 5), skill('go', 5, 5)])).toEqual([
      'go',
      'rust',
    ]);
  });

  it('drops importance 0', () => {
    expect(topTechnologies([skill('go', 0, 9), skill('rust', 1, 0)])).toEqual([
      'rust',
    ]);
  });

  it('counts a technology under two domains once, at its highest rank', () => {
    expect(
      topTechnologies([
        skill('go', 3, 9),
        skill('rust', 5, 5),
        skill('go', 8, 1),
      ]),
    ).toEqual(['go', 'rust']);
  });

  it('searches only techs with search wording, never a concept tag such as saas', () => {
    expect(
      topTechnologies([
        skill('saas', 10, 10),
        skill('go', 8),
        skill('microservices', 9),
        skill('nodejs', 7),
      ]),
    ).toEqual(['go', 'nodejs']);
  });

  it('gives a profile whose techs all lack search wording the same top technologies as no skills', () => {
    expect(
      topTechnologies([skill('saas', 10), skill('microservices', 9)]),
    ).toEqual(topTechnologies([]));
  });

  it('keeps only the top 2 of 5', () => {
    expect(
      topTechnologies([
        skill('go', 1, 5),
        skill('rust', 2, 5),
        skill('nestjs', 3, 5),
        skill('react', 4, 5),
        skill('postgresql', 5, 5),
      ]),
    ).toEqual(['postgresql', 'react']);
  });
});

describe('technologySets', () => {
  const [a, b, c] = ['go', 'rust', 'nestjs'];
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
