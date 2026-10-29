import contractJson from 'src/database/contract.json';
import {
  Arrangement,
  ContactKind,
  Engagement,
  Language,
  Position,
  Region,
  Seniority,
  SkillDomain,
  Technology,
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
    ['Position', Position],
    ['Language', Language],
    ['Region', Region],
    ['Engagement', Engagement],
    ['Arrangement', Arrangement],
    ['Seniority', Seniority],
    ['ContactKind', ContactKind],
    ['Technology', Technology],
    ['SkillDomain', SkillDomain],
  ] as const)('%s matches the data contract', (name, values) => {
    expect(Object.values(values).sort()).toEqual(contractValues(name).sort());
  });
});
