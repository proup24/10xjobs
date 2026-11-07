import { describe, expect, it } from 'vitest';
import { SkillDomain } from 'src/common/enums';
import { SKILL_DOMAINS } from './shared';

describe('SKILL_DOMAINS', () => {
  it('matches the contract SkillDomain enum', () => {
    expect([...SKILL_DOMAINS].sort()).toEqual(
      Object.values(SkillDomain).sort(),
    );
  });
});
