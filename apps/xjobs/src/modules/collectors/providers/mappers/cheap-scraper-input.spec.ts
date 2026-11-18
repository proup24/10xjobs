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

  it('pins the place with a geoId alone, with no text location', () => {
    const url = new URL(
      linkedinJobSearchUrl(
        'a OR b',
        {
          location: 'morocco',
          geoId: '102787409',
          experienceLevel: '4',
          workType: '2',
        },
        3600,
      ),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      keywords: 'a OR b',
      geoId: '102787409',
      f_E: '4',
      f_WT: '2',
      sortBy: 'DD',
      f_TPR: 'r3600',
    });
    expect(url.searchParams.has('location')).toBe(false);
  });

  it('sends GLOBAL as Worldwide and omits missing filters', () => {
    const url = new URL(linkedinJobSearchUrl('x', { location: 'GLOBAL' }, 60));
    expect(url.searchParams.get('location')).toBe('Worldwide');
    expect(url.searchParams.has('f_E')).toBe(false);
    expect(url.searchParams.has('f_WT')).toBe(false);
    expect(url.href).not.toContain('undefined');
  });
});
