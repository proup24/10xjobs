import {
  linkedinSearchKey,
  toHarvestJobSearchInput,
} from './linkedin-job-board.mapper';

describe('toHarvestJobSearchInput', () => {
  it('maps a builder to the actor input', () => {
    expect(
      toHarvestJobSearchInput(
        'backend golang',
        { location: 'Germany', experienceLevel: '4,5', workType: '2' },
        100,
      ),
    ).toEqual({
      jobTitles: ['backend golang'],
      locations: ['Germany'],
      experienceLevel: ['mid-senior', 'director'],
      workplaceType: ['remote'],
      postedLimit: '1h',
      sortBy: 'date',
      maxItems: 100,
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

  it('sends GLOBAL as Worldwide', () => {
    expect(
      toHarvestJobSearchInput('x', { location: 'GLOBAL' }, 10).locations,
    ).toEqual(['Worldwide']);
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
    const input = toHarvestJobSearchInput('x', { location: 'France' }, 1);
    expect(input).not.toHaveProperty('experienceLevel');
    expect(input).not.toHaveProperty('workplaceType');
  });
});

describe('linkedinSearchKey', () => {
  it('ignores the location text when a geoId pins the place', () => {
    expect(linkedinSearchKey('x', { location: 'uae', geoId: 'X' })).toBe(
      linkedinSearchKey('x', { location: 'united arab emirates', geoId: 'X' }),
    );
  });

  it('ignores the order of the experience codes', () => {
    expect(
      linkedinSearchKey('x', { location: 'a', experienceLevel: '4,5' }),
    ).toBe(linkedinSearchKey('x', { location: 'a', experienceLevel: '5,4' }));
  });

  it('differs when the work type or the keyword differs', () => {
    const base = { location: 'a' };
    expect(linkedinSearchKey('x', { ...base, workType: '1' })).not.toBe(
      linkedinSearchKey('x', { ...base, workType: '2' }),
    );
    expect(linkedinSearchKey('x', base)).not.toBe(linkedinSearchKey('y', base));
  });
});
