import { POSITION_TITLES } from './keywords';
import { POSITION_ROLE_FAMILY, roleWords } from './role-words';

describe('roleWords', () => {
  it('adds the listed languages to English', () => {
    const words = roleWords('fullstack_engineer', ['en', 'fr']);
    expect(words).toEqual(
      expect.arrayContaining([
        'engineer',
        'developer',
        'ingénieur',
        'développeur',
      ]),
    );
    expect(words).not.toContain('desarrollador');
  });

  it('uses Spanish only when listed', () => {
    const words = roleWords('fullstack_engineer', ['es']);
    expect(words).toEqual(
      expect.arrayContaining(['engineer', 'desarrollador']),
    );
    expect(words).not.toContain('ingénieur');
  });

  it('gives architects their own words', () => {
    expect(roleWords('software_architect', ['fr'])).toEqual(
      expect.arrayContaining(['architect', 'architecte']),
    );
  });

  it('devops includes the engineer words plus devops and sre', () => {
    expect(roleWords('devops_engineer', [])).toEqual(
      expect.arrayContaining(['engineer', 'devops', 'sre']),
    );
  });

  it('ignores languages without a column', () => {
    expect(roleWords('backend_engineer', ['ja'])).toEqual(
      roleWords('backend_engineer', []),
    );
  });

  it('is lowercased, sorted and deduped', () => {
    const words = roleWords('fullstack_engineer', ['en', 'fr', 'de', 'en']);
    expect(words).toEqual(
      [...new Set(words.map((w) => w.toLowerCase()))].sort(),
    );
  });

  it('adds Portuguese words for a profile listing pt', () => {
    expect(roleWords('backend_engineer', ['pt'])).toEqual(
      expect.arrayContaining([
        'desenvolvedor',
        'engenheiro',
        'programador',
        'arquiteto',
      ]),
    );
  });

  it('adds Polish words for pl', () => {
    expect(roleWords('backend_engineer', ['pl'])).toEqual(
      expect.arrayContaining(['programista', 'inżynier', 'architekt']),
    );
  });

  it('adds Portuguese and Polish architect and tech lead words', () => {
    expect(roleWords('software_architect', ['pt', 'pl'])).toEqual(
      expect.arrayContaining(['arquiteto', 'architekt']),
    );
    expect(roleWords('tech_lead', ['pt'])).toContain('líder técnico');
  });

  it('adds nothing for en only', () => {
    expect(roleWords('backend_engineer', ['en'])).toEqual(
      roleWords('backend_engineer', []),
    );
    expect(roleWords('backend_engineer', ['en'])).toEqual([
      'architect',
      'developer',
      'engineer',
      'engineering',
      'programmer',
      'tech lead',
      'technical lead',
    ]);
  });

  it('throws on a position with no family', () => {
    expect(() => roleWords('astronaut', [])).toThrow();
  });

  it('gives every position a family', () => {
    for (const position of Object.keys(POSITION_TITLES)) {
      expect(POSITION_ROLE_FAMILY[position]).toBeDefined();
    }
  });
});
