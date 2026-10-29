import contractJson from 'src/database/contract.json';
import {
  ARRANGEMENTS,
  CONTACT_KINDS,
  ENGAGEMENTS,
  LANGUAGES,
  POSITIONS,
  REGIONS,
  SENIORITIES,
  SKILL_DOMAINS,
  TECHNOLOGIES,
} from './profile.enums';

function contractValues(name: string): string[] {
  const enums = contractJson.domain.namespaces.public.enum as Record<
    string,
    { members: { value: string }[] }
  >;
  return enums[name].members.map((member) => member.value);
}

describe('profile enums', () => {
  it.each([
    ['Position', POSITIONS],
    ['Language', LANGUAGES],
    ['Region', REGIONS],
    ['Engagement', ENGAGEMENTS],
    ['Arrangement', ARRANGEMENTS],
    ['Seniority', SENIORITIES],
    ['ContactKind', CONTACT_KINDS],
    ['Technology', TECHNOLOGIES],
    ['SkillDomain', SKILL_DOMAINS],
  ] as const)('%s matches the data contract', (name, values) => {
    expect([...values].sort()).toEqual(contractValues(name).sort());
  });
});
