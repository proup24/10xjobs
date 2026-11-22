import { describe, expect, it } from 'vitest';
import { plainKeyword } from './queries';

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
