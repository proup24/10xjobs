import { Position, Seniority, Technology } from 'src/common/enums';
import { seniorityWord, technologyTerms, titleClause } from './channel.builder';

describe('titleClause', () => {
  it('ORs every title of the position, quoted, in a group', () => {
    expect(titleClause(Position.backend_engineer)).toBe(
      '("backend engineer" OR "backend developer" OR "backend software engineer")',
    );
    expect(titleClause(Position.devops_engineer)).toBe(
      '("devops engineer" OR "devops")',
    );
  });

  it('never leaves an empty group or a dangling OR', () => {
    for (const position of Object.values(Position)) {
      const clause = titleClause(position);
      expect(clause).not.toMatch(/\(\)|\( OR|OR \)|OR OR/);
      expect(clause).toMatch(/^(\(".+"( OR ".+")+\)|".+")$/);
    }
  });
});

describe('technologyTerms', () => {
  it('writes plain terms as they are and quotes terms with spaces or symbols', () => {
    expect(technologyTerms([Technology.nestjs])).toBe('nestjs');
    expect(technologyTerms([Technology.csharp])).toBe('"c#"');
    expect(technologyTerms([Technology.cpp])).toBe('"c++"');
    expect(technologyTerms([Technology.dotnet])).toBe('".net"');
    expect(technologyTerms([Technology.spring])).toBe('"spring boot"');
    expect(technologyTerms([Technology.nodejs, Technology.react])).toBe(
      '"node.js" react',
    );
  });
});

describe('seniorityWord', () => {
  it('names the levels people write, and nothing for mid or unstated', () => {
    expect(seniorityWord(Seniority.senior)).toBe('senior');
    expect(seniorityWord(Seniority.junior)).toBe('junior');
    expect(seniorityWord(Seniority.mid)).toBeNull();
    expect(seniorityWord(Seniority.unstated)).toBeNull();
  });

  it('adds nothing when a title already says it', () => {
    expect(seniorityWord(Seniority.lead, Position.tech_lead)).toBeNull();
    expect(seniorityWord(Seniority.lead, Position.backend_engineer)).toBe(
      'lead',
    );
  });
});
