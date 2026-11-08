import contractJson from '../contract/contract.json';
import { SEED } from '../seeds/vocab/seed-data';
import {
  Arrangement,
  Channel,
  ContactKind,
  Engagement,
  ProfileState,
  Seniority,
  SkillDomain,
} from './index';

function contractValues(name: string): string[] {
  const enums = contractJson.domain.namespaces.public.enum as Record<
    string,
    { members: { value: string }[] }
  >;
  return enums[name].members.map((member) => member.value);
}

describe('enums', () => {
  it.each([
    ['Engagement', Engagement],
    ['Arrangement', Arrangement],
    ['Seniority', Seniority],
    ['ContactKind', ContactKind],
    ['SkillDomain', SkillDomain],
    ['Channel', Channel],
    ['ProfileState', ProfileState],
  ] as const)('%s matches the data contract', (name, values) => {
    expect(Object.values(values).sort()).toEqual(contractValues(name).sort());
  });

  // The profile columns hold seniorities and engagements codes as text, so the
  // contract no longer ties these enums to the value lists: these tests do.
  it('Seniority matches the seniorities seed codes', () => {
    expect(Object.values(Seniority).sort()).toEqual(
      SEED.seniorities.map((term) => term.code).sort(),
    );
  });

  it('Engagement matches the engagements seed codes, without unstated', () => {
    expect(Object.values(Engagement).sort()).toEqual(
      SEED.engagements
        .map((term) => term.code)
        .filter((code) => code !== 'unstated')
        .sort(),
    );
  });
});
