import { linkedinJobSearchUrl } from './cheap-scraper-input';

describe('linkedinJobSearchUrl', () => {
  it('searches the keyword with the builder filters, newest first, in the window', () => {
    const url = new URL(
      linkedinJobSearchUrl(
        'senior backend engineer nestjs',
        { location: 'EMEA', experienceLevel: '4', workType: '2' },
        7200,
      ),
    );
    expect(url.origin + url.pathname).toBe(
      'https://www.linkedin.com/jobs/search/',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      keywords: 'senior backend engineer nestjs',
      location: 'EMEA',
      f_E: '4',
      f_WT: '2',
      sortBy: 'DD',
      f_TPR: 'r7200',
    });
  });

  it('pins the location with a geoId when the builder has one', () => {
    const url = new URL(
      linkedinJobSearchUrl(
        '("backend engineer" OR "backend developer") AND nestjs',
        { location: 'EMEA', geoId: '91000007' },
        60,
      ),
    );
    expect(url.searchParams.get('geoId')).toBe('91000007');
    expect(url.searchParams.get('location')).toBe('EMEA');
    expect(url.searchParams.get('keywords')).toBe(
      '("backend engineer" OR "backend developer") AND nestjs',
    );
  });

  it('sends GLOBAL as Worldwide and omits missing filters', () => {
    const url = new URL(linkedinJobSearchUrl('x', { location: 'GLOBAL' }, 60));
    expect(url.searchParams.get('location')).toBe('Worldwide');
    expect(url.searchParams.has('f_E')).toBe(false);
    expect(url.searchParams.has('f_WT')).toBe(false);
    expect(url.href).not.toContain('undefined');
  });
});
