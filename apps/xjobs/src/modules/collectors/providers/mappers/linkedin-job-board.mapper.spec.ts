import { linkedinKeyword } from 'src/modules/queries/channels/linkedin_keyword';
import {
  harvestGroupKey,
  linkedinGroupKey,
  mergedExperienceLevel,
  mergedLinkedinKeyword,
  toHarvestJobSearchInput,
} from './linkedin-job-board.mapper';

describe('toHarvestJobSearchInput', () => {
  it('maps a builder to the actor input', () => {
    expect(
      toHarvestJobSearchInput(
        'backend golang',
        { location: 'Germany', experienceLevel: '4,5', workType: '2' },
        1000,
      ),
    ).toEqual({
      jobTitles: ['backend golang'],
      geoIds: ['101282230'],
      experienceLevel: ['mid-senior', 'director'],
      workplaceType: ['remote'],
      postedLimit: '1h',
      sortBy: 'date',
      maxItems: 1000,
    });
  });

  it('uses the geoId instead of the location text', () => {
    const input = toHarvestJobSearchInput(
      'x',
      { location: 'uae', geoId: '104305776' },
      10,
    );
    expect(input.geoIds).toEqual(['104305776']);
    expect(input).not.toHaveProperty('locations');
  });

  it('sends a verified geoId for every place, never text', () => {
    const geo = (params: Record<string, unknown>) =>
      toHarvestJobSearchInput('x', params, 1).geoIds;
    expect(geo({ location: 'european economic area' })).toEqual(['91000002']);
    expect(geo({ location: 'North Africa' })).toEqual(['103537801']);
    expect(geo({ location: 'GLOBAL' })).toEqual(['92000000']);
    expect(geo({})).toEqual(['92000000']);
    expect(
      toHarvestJobSearchInput('x', { location: 'Germany' }, 1),
    ).not.toHaveProperty('locations');
  });

  it('throws for a place without a geoId', () => {
    expect(() =>
      toHarvestJobSearchInput('x', { location: 'atlantis' }, 1),
    ).toThrow(/No LinkedIn geoId for location "atlantis"/);
    expect(() => linkedinGroupKey({ location: 'atlantis' })).toThrow(
      /No LinkedIn geoId for location "atlantis"/,
    );
  });

  it('drops an inherited property name used as a code', () => {
    expect(
      toHarvestJobSearchInput('x', { experienceLevel: 'constructor,4' }, 1)
        .experienceLevel,
    ).toEqual(['mid-senior']);
  });

  it('maps the filter codes and drops unknown ones', () => {
    expect(
      toHarvestJobSearchInput('x', { experienceLevel: '1,9' }, 1)
        .experienceLevel,
    ).toEqual(['internship']);
    expect(
      toHarvestJobSearchInput('x', { workType: '1' }, 1).workplaceType,
    ).toEqual(['office']);
    expect(
      toHarvestJobSearchInput('x', { workType: '3' }, 1).workplaceType,
    ).toEqual(['hybrid']);
  });

  it('omits the filters a builder lacks', () => {
    const input = toHarvestJobSearchInput('x', { location: 'france' }, 1);
    expect(input).not.toHaveProperty('experienceLevel');
    expect(input).not.toHaveProperty('workplaceType');
  });
});

describe('linkedinGroupKey', () => {
  it('is equal whether the geoId is stored or resolved from the location', () => {
    expect(linkedinGroupKey({ location: 'morocco' })).toBe(
      linkedinGroupKey({ location: 'morocco', geoId: '102787409' }),
    );
  });

  it('pins the key shape, without the keyword', () => {
    expect(
      linkedinGroupKey({
        location: 'morocco',
        experienceLevel: '5,4',
        workType: '2',
      }),
    ).toBe(
      '{"place":{"geoId":"102787409"},"experienceLevel":["director","mid-senior"],"workplaceType":["remote"]}',
    );
  });

  it('ignores the order of the experience codes', () => {
    expect(
      linkedinGroupKey({ location: 'canada', experienceLevel: '4,5' }),
    ).toBe(linkedinGroupKey({ location: 'canada', experienceLevel: '5,4' }));
  });

  it('differs when the work type differs', () => {
    const base = { location: 'canada' };
    expect(linkedinGroupKey({ ...base, workType: '1' })).not.toBe(
      linkedinGroupKey({ ...base, workType: '2' }),
    );
  });
});

describe('mergedLinkedinKeyword', () => {
  it('is the keyword of the union of the members role words and spellings', () => {
    expect(
      mergedLinkedinKeyword([
        { params: { roleWords: ['backend'], spellings: ['go', 'golang'] } },
        { params: { roleWords: ['developer'], spellings: ['go', 'rust'] } },
      ]),
    ).toBe(linkedinKeyword(['backend', 'developer'], ['go', 'golang', 'rust']));
  });
});

describe('harvestGroupKey', () => {
  it('is the group key without the level', () => {
    const params = { location: 'Germany', experienceLevel: '4', workType: '2' };
    expect(harvestGroupKey(params)).toBe(
      linkedinGroupKey({ location: 'Germany', workType: '2' }),
    );
  });
  it('is equal across levels and differs across work types', () => {
    const a = harvestGroupKey({ location: 'Germany', experienceLevel: '2' });
    expect(a).toBe(
      harvestGroupKey({ location: 'Germany', experienceLevel: '5' }),
    );
    expect(a).not.toBe(harvestGroupKey({ location: 'Germany', workType: '3' }));
  });
});

describe('mergedExperienceLevel', () => {
  const q = (experienceLevel?: string) => ({
    params: experienceLevel === undefined ? {} : { experienceLevel },
  });
  it('is the sorted, deduplicated union of the members codes', () => {
    expect(mergedExperienceLevel([q('5'), q('3'), q('4'), q('4')])).toBe(
      '3,4,5',
    );
    expect(mergedExperienceLevel([q('4,5'), q('2')])).toBe('2,4,5');
  });
  it('is undefined when any member has no level', () => {
    expect(mergedExperienceLevel([q('4'), q()])).toBeUndefined();
    expect(mergedExperienceLevel([q('4'), q('')])).toBeUndefined();
  });
  it('is undefined for no members', () => {
    expect(mergedExperienceLevel([])).toBeUndefined();
  });
});
