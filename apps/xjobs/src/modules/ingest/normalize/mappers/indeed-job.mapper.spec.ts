import { Channel } from 'src/common/enums';
import fixtures from '../../utils/fixtures/indeed-valig.json';
import { normalize } from '../normalize';
import { isIndeedHost } from './indeed-job.mapper';

const scrapedAt = new Date('2026-11-27T00:00:00.000Z');
const [remote, moroccan, hybrid] = fixtures as Record<string, any>[];

function mapped(item: unknown) {
  const result = normalize(Channel.INDEED, item, { scrapedAt });
  if (!('record' in result)) throw new Error(result.invalid);
  return result.record;
}

describe('mapIndeedJob', () => {
  it('maps a remote valig item', () => {
    const record = mapped(remote);
    expect(record).toMatchObject({
      kind: 'job',
      title: remote.title,
      companyName: 'Concentrix',
      companyUrl: 'https://www.indeed.com/cmp/Concentrix',
      countryCode: 'US',
      state: null,
      city: null,
      regionCode: null,
      workplaceType: 'remote',
      salary: {
        text: null,
        min: 92250,
        max: 120000,
        currency: 'USD',
        period: 'YEARLY',
        providedByEmployer: true,
      },
      publishedAt: '2026-11-20',
      postedAt: '2026-11-20T06:00:00.000Z',
      expiresAt: null,
      contractType: 'Full-time',
      employmentType: null,
      experienceLevel: null,
      applyUrl: remote.jobUrl,
      postingUrl: 'https://www.indeed.com/viewjob?jk=615c52287907ef33',
      closed: false,
    });
    expect(record.descriptionText).toBeTruthy();
    expect(record.descriptionHtml).toBe(remote.description.html);
  });

  it('keeps an Indeed-hosted jobUrl out of applyUrl', () => {
    const record = mapped(moroccan);
    expect(record).toMatchObject({
      applyUrl: null,
      workplaceType: null,
      contractType: 'Temps plein',
      countryCode: 'MA',
      city: 'Rabat',
      state: '4',
      regionCode: null,
      location: 'Rabat, 4, Maroc',
      salary: null,
    });
  });

  it("maps the employer's hybrid tag and an hourly salary", () => {
    const record = mapped(hybrid);
    expect(record.workplaceType).toBe('hybrid');
    expect(record.salary).toMatchObject({ period: 'HOURLY', min: 65, max: 70 });
  });

  it('maps both tags to remote', () => {
    const both = {
      ...hybrid,
      employerAttributes: { DSQF7: 'Remote', PAXZC: 'Hybrid work' },
    };
    expect(mapped(both).workplaceType).toBe('remote');
  });

  it('ignores a remote tag the employer did not set', () => {
    const { DSQF7: _remote, ...rest } = remote.employerAttributes;
    const item = { ...remote, employerAttributes: rest };
    expect(item.attributes.DSQF7).toBeDefined();
    expect(mapped(item).workplaceType).toBeNull();
  });

  it('drops a "Remote" city', () => {
    const item = {
      ...remote,
      location: {
        city: 'Remote',
        countryCode: 'US',
        countryName: 'United States',
      },
    };
    const record = mapped(item);
    expect(record.city).toBeNull();
    expect(record.location).toBe('Remote, United States');
  });

  it('has no salary when baseSalary has no numbers', () => {
    const item = {
      ...remote,
      baseSalary: {
        min: null,
        max: null,
        unitOfWork: null,
        currencyCode: null,
      },
    };
    expect(mapped(item).salary).toBeNull();
  });

  it('passes an unknown salary unit through', () => {
    const item = {
      ...remote,
      baseSalary: {
        min: 1,
        max: null,
        unitOfWork: 'WEEK',
        currencyCode: 'USD',
      },
    };
    expect(mapped(item).salary).toMatchObject({ min: 1, period: 'WEEK' });
  });

  it('falls back to dateOnIndeed and to the HTML description', () => {
    const item = {
      ...remote,
      datePublished: null,
      description: { text: null, html: '<p>Build <b>APIs</b></p>' },
    };
    const record = mapped(item);
    expect(record.postedAt).toBe(new Date(remote.dateOnIndeed).toISOString());
    expect(record.publishedAt).toBe('2026-11-23');
    expect(record.descriptionText).toBe('Build APIs');
  });

  it('reads a valid expirationDate', () => {
    const item = { ...remote, expirationDate: '2026-12-20T00:00:00.000Z' };
    expect(mapped(item).expiresAt).toBe('2026-12-20T00:00:00.000Z');
  });

  it('builds the posting URL from the job key when url is missing', () => {
    const record = mapped({ ...remote, url: null });
    expect(record.postingUrl).toBe(
      'https://www.indeed.com/viewjob?jk=615c52287907ef33',
    );
  });

  it('upgrades an http posting URL to https', () => {
    const record = mapped({
      ...remote,
      url: 'http://ma.indeed.com/viewjob?jk=abc',
    });
    expect(record.postingUrl).toBe('https://ma.indeed.com/viewjob?jk=abc');
  });
});

describe('isIndeedHost', () => {
  it.each([
    ['https://www.indeed.com/x', true],
    ['http://ma.indeed.com/x', true],
    ['https://indeed.com/x', true],
    ['https://notindeed.com/x', false],
    ['https://indeed.com.evil.io/x', false],
  ])('%s -> %s', (url, expected) => {
    expect(isIndeedHost(new URL(url))).toBe(expected);
  });
});
