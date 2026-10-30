import { Technology } from 'src/common/enums';
import type { RankedSkill } from '../types';
import { technologySets, topTechnologies } from './technology';

const skill = (
  technology: Technology,
  importance: number,
  mastery: number,
): RankedSkill => ({ technology, importance, mastery });

describe('topTechnologies', () => {
  it('orders by importance, then mastery', () => {
    expect(
      topTechnologies([
        skill(Technology.go, 5, 9),
        skill(Technology.rust, 8, 5),
        skill(Technology.nestjs, 8, 5),
      ]),
    ).toEqual([Technology.nestjs, Technology.rust, Technology.go]);
  });

  it('breaks full ties by technology name', () => {
    expect(
      topTechnologies([
        skill(Technology.rust, 5, 5),
        skill(Technology.go, 5, 5),
      ]),
    ).toEqual([Technology.go, Technology.rust]);
  });

  it('drops importance 0', () => {
    expect(
      topTechnologies([
        skill(Technology.go, 0, 9),
        skill(Technology.rust, 1, 0),
      ]),
    ).toEqual([Technology.rust]);
  });

  it('counts a technology under two domains once, at its highest rank', () => {
    expect(
      topTechnologies([
        skill(Technology.go, 3, 9),
        skill(Technology.rust, 5, 5),
        skill(Technology.go, 8, 1),
      ]),
    ).toEqual([Technology.go, Technology.rust]);
  });

  it('keeps only the top 3 of 5', () => {
    expect(
      topTechnologies([
        skill(Technology.go, 1, 5),
        skill(Technology.rust, 2, 5),
        skill(Technology.nestjs, 3, 5),
        skill(Technology.react, 4, 5),
        skill(Technology.postgresql, 5, 5),
      ]),
    ).toEqual([Technology.postgresql, Technology.react, Technology.nestjs]);
  });
});

describe('technologySets', () => {
  const [a, b, c] = [Technology.go, Technology.rust, Technology.nestjs];
  const skills = [skill(a, 9, 5), skill(b, 8, 5), skill(c, 7, 5)];

  it('returns 5 sets for 3 technologies', () => {
    expect(technologySets(skills)).toEqual([[a], [b], [c], [a, b], [a, b, c]]);
  });

  it('returns 3 sets for 2 technologies', () => {
    expect(technologySets(skills.slice(0, 2))).toEqual([[a], [b], [a, b]]);
  });

  it('returns 1 set for 1 technology', () => {
    expect(technologySets(skills.slice(0, 1))).toEqual([[a]]);
  });

  it('returns one empty set for 0 technologies', () => {
    expect(technologySets([])).toEqual([[]]);
  });
});
