import { cleanPostText, comparableText, sortLinks } from './clean';

describe('cleanPostText', () => {
  it('drops emoji, hashtag marks, blank-line runs and the see-more tail', () => {
    expect(
      cleanPostText(
        'We are hiring 🚀 #ReactJS engineers\n\n\n\nDM me…see more',
      ),
    ).toBe('We are hiring ReactJS engineers\n\nDM me');
  });

  it('handles the scraped hashtag form and mentions', () => {
    expect(cleanPostText('hashtag#nodejs')).toBe('nodejs');
    expect(cleanPostText('@Jane Doe')).toBe('Jane Doe');
  });

  it('can end up empty', () => {
    expect(cleanPostText('🔥🔥 #hiring …see more')).toBe('hiring');
    expect(cleanPostText('🔥 …see more')).toBe('');
  });

  it('strips the other see-more spellings only at the end', () => {
    expect(cleanPostText('Join us ...see more')).toBe('Join us');
    expect(cleanPostText('Join us … more')).toBe('Join us');
    expect(cleanPostText('see more of this, see more')).toBe(
      'see more of this, see more',
    );
  });
});

describe('comparableText', () => {
  it('folds accents, case and punctuation', () => {
    expect(comparableText('Développeur  Full-Stack!')).toBe(
      'developpeur full stack',
    );
  });
});

describe('sortLinks', () => {
  it('sorts emails, LinkedIn jobs, ATS postings and other links', () => {
    const ashby =
      'https://jobs.ashbyhq.com/acme/1a2b3c4d-0000-4000-8000-000000000000';
    const links = sortLinks(
      `Apply: Jobs@Acme.io or ${ashby}. See https://www.linkedin.com/jobs/view/4012345678/ and https://lnkd.in/abc.`,
      [],
    );
    expect(links.emails).toEqual(['jobs@acme.io']);
    expect(links.linkedinJobIds).toEqual(['4012345678']);
    expect(links.atsPostings).toEqual([{ provider: 'ashby', url: ashby }]);
    expect(links.other).toEqual(['https://lnkd.in/abc']);
  });

  it('reads currentJobId and dedupes in order', () => {
    const links = sortLinks(
      'https://www.linkedin.com/jobs/search/?currentJobId=4012345678',
      ['https://linkedin.com/jobs/view/4012345678', 'https://lnkd.in/x'],
    );
    expect(links.linkedinJobIds).toEqual(['4012345678']);
    expect(links.other).toEqual(['https://lnkd.in/x']);
  });
});
