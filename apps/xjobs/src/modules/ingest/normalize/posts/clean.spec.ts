import {
  cleanPostText,
  comparableText,
  hasSeeMoreTail,
  sortLinks,
} from './clean';

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

describe('hasSeeMoreTail', () => {
  it('is true exactly when cleaning cuts the see-more tail', () => {
    expect(hasSeeMoreTail('DM me…see more')).toBe(true);
    expect(hasSeeMoreTail('Join us ...see more')).toBe(true);
    expect(hasSeeMoreTail('Join us … more')).toBe(true);
    expect(hasSeeMoreTail('DM me …see more 🚀')).toBe(true);
    expect(hasSeeMoreTail('see more of this, see more')).toBe(false);
    expect(hasSeeMoreTail('A full post.')).toBe(false);
    expect(hasSeeMoreTail('')).toBe(false);
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

  it('accepts regional LinkedIn hosts', () => {
    expect(
      sortLinks('https://ma.linkedin.com/jobs/view/123', []).linkedinJobIds,
    ).toEqual(['123']);
  });

  it('keeps balanced parentheses and drops closing marks and ellipses', () => {
    const links = sortLinks(
      'a https://x.com/X_(y) b (https://x.com/p) c https://lnkd.in/abc… d “https://lnkd.in/q”',
      [],
    );
    expect(links.other).toEqual([
      'https://x.com/X_(y)',
      'https://x.com/p',
      'https://lnkd.in/abc',
      'https://lnkd.in/q',
    ]);
  });
});

describe('cleanPostText details', () => {
  it('removes flags, keycaps and skin tones', () => {
    expect(cleanPostText('Rabat 🇲🇦 1️⃣ ok 👍🏽')).toBe('Rabat 1 ok');
  });

  it('only strips a # at the start of a word', () => {
    expect(cleanPostText('see https://x.com/a#sec and issue#12 #go')).toBe(
      'see https://x.com/a#sec and issue#12 go',
    );
  });
});
