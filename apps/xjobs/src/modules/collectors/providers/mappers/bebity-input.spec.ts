import { BEBITY_PLACES, toBebityInput } from './bebity-input';
import { linkedinGeoId } from './linkedin-job-board.mapper';

describe('toBebityInput', () => {
  it("builds bebity's fields for a remote mid-level US search", () => {
    expect(
      toBebityInput(
        'kw',
        { location: 'united states', workType: '2', experienceLevel: '4' },
        100,
      ),
    ).toEqual({
      titles: ['kw'],
      locations: ['United States'],
      workTypes: ['2'],
      experienceLevels: ['4'],
      publishedAt: 'r3600',
      rows: 100,
      companyProfile: false,
      enrichCompany: false,
    });
  });

  it('splits several level codes', () => {
    expect(
      toBebityInput(
        'kw',
        { location: 'united states', experienceLevel: '3,4' },
        10,
      ).experienceLevels,
    ).toEqual(['3', '4']);
  });

  it('omits filters the builder does not set', () => {
    const input = toBebityInput('kw', { location: 'united states' }, 10);
    expect(input).not.toHaveProperty('workTypes');
    expect(input).not.toHaveProperty('experienceLevels');
  });

  it('names the place by geoId, whatever its spelling', () => {
    expect(
      toBebityInput('kw', { location: 'north africa' }, 10).locations,
    ).toEqual(['Africa']);
  });

  it('refuses a geoId with no bebity place', () => {
    expect(() => toBebityInput('kw', { location: 'mena' }, 10)).toThrow();
  });

  it('has a place for every geoId but MENA', () => {
    for (const location of [
      'morocco',
      'united states',
      'europe',
      'middle east',
      'latin america',
      'africa',
      'canada',
    ])
      expect(BEBITY_PLACES[linkedinGeoId({ location })]).toBeDefined();
    expect(BEBITY_PLACES[linkedinGeoId({ location: 'mena' })]).toBeUndefined();
    expect(Object.keys(BEBITY_PLACES)).toHaveLength(7);
  });
});
