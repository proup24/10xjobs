import { describe, expect, it } from 'vitest';
import { mostCommonRoleWord, plainKeyword } from './queries';

describe('plainKeyword', () => {
  it('renders the technology as its first searched spelling', () => {
    expect(plainKeyword('developer', 'typescript')).toBe(
      'developer typescript',
    );
    expect(plainKeyword('developer', 'go')).toBe('developer golang');
    expect(plainKeyword('engineer', 'csharp')).toBe('engineer c#');
    expect(plainKeyword('developer', 'nodejs')).toBe('developer nodejs');
  });

  it('falls back to the code for a technology that is not searchable', () => {
    expect(plainKeyword('developer', 'not_a_tech')).toBe(
      'developer not_a_tech',
    );
  });
});

describe('mostCommonRoleWord', () => {
  it('picks the word the most builders search, not the first alphabetically', () => {
    expect(
      mostCommonRoleWord([
        ['architect', 'engineer'],
        ['engineer', 'developer'],
        ['engineer'],
        ['developer'],
      ]),
    ).toBe('engineer');
  });

  it('counts a word once per builder and breaks ties alphabetically', () => {
    expect(
      mostCommonRoleWord([['engineer', 'engineer', 'engineer'], ['developer']]),
    ).toBe('developer');
  });

  it('breaks a tie with the profile position, as on dev where every builder searches the same words', () => {
    const same = [
      'architect',
      'developer',
      'engineer',
      'programmer',
      'tech lead',
    ];
    expect(mostCommonRoleWord([same, same, same], 'fullstack_engineer')).toBe(
      'engineer',
    );
    expect(mostCommonRoleWord([same, same], 'backend_developer')).toBe(
      'developer',
    );
    expect(mostCommonRoleWord([same, same], 'data_scientist')).toBe(
      'architect',
    );
  });

  it('prefers a word more builders search over the position', () => {
    expect(
      mostCommonRoleWord(
        [['developer', 'engineer'], ['developer']],
        'fullstack_engineer',
      ),
    ).toBe('developer');
  });

  it('is null when no builder has a role word', () => {
    expect(mostCommonRoleWord([[], []])).toBeNull();
    expect(mostCommonRoleWord([])).toBeNull();
  });
});
