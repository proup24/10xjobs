import { SkillDomain } from 'src/common/enums';
import type { RankedSkill } from '../types';
import { Channel } from 'src/common/enums';
import { linkedinKeywordFits } from '../channels/linkedin_keyword';
import { roleWords } from '../builders/role-words';
import { searchSpellings } from '../builders/search-spellings';
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
    ).toEqual(['nestjs', 'rust', 'go']);
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

  it('keeps every searchable technology, best first', () => {
    expect(
      topTechnologies([
        skill('go', 1, 5),
        skill('rust', 2, 5),
        skill('nestjs', 3, 5),
        skill('react', 4, 5),
        skill('postgresql', 5, 5),
      ]),
    ).toEqual(['postgresql', 'react', 'nestjs', 'rust', 'go']);
  });
});

describe('technologySets', () => {
  const [a, b, c] = ['go', 'rust', 'nestjs'];
  const skills = [
    skill(a, 9, 5, SkillDomain.backend),
    skill(b, 8, 5, SkillDomain.devops),
    skill(c, 7, 5),
  ];

  it('returns one set per technology, with its domain', () => {
    expect(technologySets(skills, Channel.ASHBY)).toEqual([
      { technologies: [a], domain: SkillDomain.backend },
      { technologies: [b], domain: SkillDomain.devops },
      { technologies: [c], domain: SkillDomain.backend },
    ]);
  });

  it('returns 1 set for 1 technology', () => {
    expect(technologySets(skills.slice(0, 1), Channel.ASHBY)).toEqual([
      { technologies: [a], domain: SkillDomain.backend },
    ]);
  });

  it('takes the domain of the best-ranked entry of a technology', () => {
    expect(
      technologySets(
        [
          skill(a, 3, 9, SkillDomain.devops),
          skill(a, 8, 1, SkillDomain.backend),
        ],
        Channel.ASHBY,
      ),
    ).toEqual([{ technologies: [a], domain: SkillDomain.backend }]);
  });

  it('returns no sets without a ranked skill', () => {
    expect(technologySets([], Channel.ASHBY)).toEqual([]);
    expect(technologySets([skill(a, 0, 9)], Channel.ASHBY)).toEqual([]);
  });
});

describe('technologySets for the LinkedIn job board', () => {
  it('returns one set holding every top technology, with the first top skill domain', () => {
    const names = [
      'go',
      'rust',
      'nestjs',
      'react',
      'java',
      'python',
      'sql',
      'aws',
    ];
    const skills = names.map((name, i) =>
      skill(
        name,
        i === 0 ? 9 : 5,
        5,
        i === 0 ? SkillDomain.devops : SkillDomain.backend,
      ),
    );
    const sets = technologySets(skills, Channel.LINKEDIN_JOB_BOARD);
    expect(sets).toHaveLength(1);
    expect(sets[0].technologies).toEqual(topTechnologies(skills));
    expect(sets[0].technologies).toHaveLength(8);
    expect(sets[0].domain).toBe(SkillDomain.devops);
  });

  it('returns no set without a ranked skill', () => {
    expect(technologySets([], Channel.LINKEDIN_JOB_BOARD)).toEqual([]);
  });

  it('keeps one set per technology on other channels', () => {
    const skills = [skill('go', 5), skill('rust', 4)];
    expect(technologySets(skills, Channel.ASHBY)).toHaveLength(2);
  });
});

describe('technologySets for the LinkedIn job board, by keyword length', () => {
  const fits = (roles: string[], technologies: string[]) =>
    linkedinKeywordFits(roles, technologies.flatMap(searchSpellings));
  /** The 8 technologies of the dev-profile fixture above, best first. */
  const eight = ['go', 'rust', 'nestjs', 'react', 'java', 'python', 'sql', 'aws'];
  const ranked = (names: string[]) =>
    names.map((name, i) =>
      skill(
        name,
        10 - Math.floor(i / 2),
        5,
        i % 3 === 0 ? SkillDomain.devops : SkillDomain.backend,
      ),
    );
  const twelve = [
    'typescript',
    'javascript',
    'react_native',
    'kubernetes',
    'postgresql',
    'nodejs',
    'nextjs',
    'nestjs',
    'elasticsearch',
    'terraform',
    'graphql',
    'rabbitmq',
  ];

  it('keeps the dev profile (8 technologies, en and fr) in one set', () => {
    const roles = roleWords('backend_engineer', ['en', 'fr']);
    const sets = technologySets(ranked(eight), Channel.LINKEDIN_JOB_BOARD, roles);
    expect(sets).toHaveLength(1);
    expect(sets[0].technologies).toHaveLength(8);
  });

  it('packs 12 technologies with en and es into several sets that each fit', () => {
    const roles = roleWords('backend_engineer', ['en', 'es']);
    const skills = ranked(twelve);
    expect(fits(roles, twelve)).toBe(false);
    const sets = technologySets(skills, Channel.LINKEDIN_JOB_BOARD, roles);
    expect(sets.length).toBeGreaterThan(1);
    for (const set of sets) expect(fits(roles, set.technologies)).toBe(true);
    // Every technology once, in rank order, and the fewest sets greedy packing allows.
    expect(sets.flatMap((set) => set.technologies)).toEqual(
      topTechnologies(skills),
    );
    for (let i = 0; i + 1 < sets.length; i++)
      expect(
        fits(roles, [...sets[i].technologies, sets[i + 1].technologies[0]]),
      ).toBe(false);
  });

  it('gives each set the domain of its first technology', () => {
    const roles = roleWords('backend_engineer', ['en', 'es']);
    const skills = ranked(twelve);
    const domainOf = new Map(skills.map((s) => [s.technology, s.domain]));
    for (const set of technologySets(skills, Channel.LINKEDIN_JOB_BOARD, roles))
      expect(set.domain).toBe(domainOf.get(set.technologies[0]));
  });

  it('packs the same whatever the input order', () => {
    const roles = roleWords('backend_engineer', ['en', 'es']);
    const skills = ranked(twelve);
    const expected = technologySets(skills, Channel.LINKEDIN_JOB_BOARD, roles);
    for (const order of [
      [...skills].reverse(),
      [...skills.slice(5), ...skills.slice(0, 5)],
    ])
      expect(technologySets(order, Channel.LINKEDIN_JOB_BOARD, roles)).toEqual(
        expected,
      );
    expect(
      technologySets(skills, Channel.LINKEDIN_JOB_BOARD, [...roles].reverse()),
    ).toEqual(expected);
  });

  it('still gives a technology that cannot fit alone its own set', () => {
    // 24 role words leave no room for a technology with two spellings.
    const roles = Array.from({ length: 24 }, (_, i) => `role${i}`);
    expect(fits(roles, ['nodejs'])).toBe(false);
    const sets = technologySets(
      [skill('go', 9), skill('nodejs', 8), skill('rust', 7)],
      Channel.LINKEDIN_JOB_BOARD,
      roles,
    );
    expect(sets.map((set) => set.technologies)).toEqual([
      ['go'],
      ['nodejs'],
      ['rust'],
    ]);
  });
});
