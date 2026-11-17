import { Channel } from 'src/common/enums';
import cheapJob from '../utils/fixtures/linkedin-job-cheap.json';
import harvest from '../utils/fixtures/linkedin-job-harvest.json';
import { jobKey } from './job-key';
import { normalize as normalizeRaw, type NormalizedRecord } from '.';

type Item = Record<string, unknown> & { id: string };
const items = harvest as unknown as Item[];
const byId = (id: string): Item => items.find((i) => i.id === id) as Item;

const scrapedAt = new Date('2026-11-12T00:00:00.000Z');

function map(item: Record<string, unknown>): NormalizedRecord {
  const result = normalizeRaw(Channel.LINKEDIN_JOB_BOARD, item, { scrapedAt });
  if ('invalid' in result) throw new Error(result.invalid);
  return result.record;
}

const remote = byId('4488222855');
const hybrid = byId('4471204920');
const onsite = byId('4488224851');
const nullWorkplace = byId('4472166776');
const easyApply = byId('4488210322');
const complexOutside = byId('4488667576');

describe('normalize harvestapi LinkedIn jobs', () => {
  it('maps a remote item', () => {
    const r = map(remote);
    expect(r).toMatchObject({
      kind: 'job',
      workplaceType: 'remote',
      remoteAllowed: true,
      regionCode: 'EU',
      countryCode: null,
      poster: {
        name: 'Jane Recruiter',
        profileUrl: 'https://www.linkedin.com/in/placeholder',
        type: 'person',
      },
      employmentType: 'full_time',
      contractType: 'Full-time',
      listingState: 'LISTED',
      closed: false,
      publishedAt: '2026-11-11',
      postedAt: remote.postedDate,
      postingUrl: 'https://www.linkedin.com/jobs/view/4488222855',
    });
    expect(r.descriptionHtml).toBeTruthy();
    expect(r.descriptionText).toBeTruthy();
  });

  it('builds the description text from the HTML, keeping its breaks', () => {
    const r = map({
      ...remote,
      descriptionHtml:
        '<p>Buscamos un desarrollador.</p><ul><li>React y Next.js</li><li>Python</li></ul>',
      descriptionText: 'Buscamos un desarrollador.React y Next.jsPython',
    });
    expect(r.descriptionText).toContain('Buscamos un desarrollador.\n');
    expect(r.descriptionText).toMatch(/React y Next\.js\n[^\n]*Python/);
  });

  it("falls back to the actor's text when there is no HTML", () => {
    const r = map({
      ...remote,
      descriptionHtml: null,
      descriptionText: 'Plain text only',
    });
    expect(r.descriptionText).toBe('Plain text only');
  });

  it('maps the shared facts of every item', () => {
    for (const item of items) {
      const r = map(item);
      expect(r.experienceLevel).toBe(item.experienceLevel ?? null);
      expect(r.applicantTrackingSystem).toBe(
        item.applicantTrackingSystem ?? null,
      );
      expect(r.applicantCount).toBe(item.applicants);
      expect(r.expiresAt).toBe(item.expireAt);
    }
  });

  it('maps an on-site item with a salary and a country', () => {
    expect(map(onsite)).toMatchObject({
      workplaceType: 'onsite',
      countryCode: 'FR',
      salary: {
        text: '600 - 700 EUR',
        min: 600,
        max: 700,
        currency: 'EUR',
        period: 'MONTHLY',
      },
    });
  });

  it('maps parsed city and state', () => {
    expect(map(hybrid)).toMatchObject({
      city: 'Paris',
      state: 'Île-de-France',
    });
    expect(map(byId('4489024089'))).toMatchObject({
      city: 'Rueil-Malmaison',
      state: 'Île-de-France',
    });
    expect(map(byId('4490001823'))).toMatchObject({
      city: null,
      state: 'California',
    });
  });

  it('maps the location geoId', () => {
    expect(map(remote)).toMatchObject({
      geoId: '91000000',
      countryCode: null,
      regionCode: 'EU',
    });
    expect(map(byId('4454530249'))).toMatchObject({
      geoId: '91000007',
      regionCode: 'EMEA',
    });
    expect(map(byId('4489984111'))).toMatchObject({
      geoId: '91000022',
      regionCode: 'NAMER',
    });
  });

  it('keeps providedByEmployer on salary', () => {
    expect(map(onsite).salary?.providedByEmployer).toBe(true);
    expect(map(byId('4489984111')).salary).toMatchObject({
      period: 'HOURLY',
      providedByEmployer: true,
    });
    expect(map(remote).salary).toBeNull();
  });

  it('reads providedByEmployer only as a boolean', () => {
    const salary = { ...(onsite.salary as object), providedByEmployer: 'yes' };
    expect(map({ ...onsite, salary }).salary?.providedByEmployer).toBeNull();
  });

  it('cheap_scraper items get null city, state and geoId', () => {
    const result = normalizeRaw(Channel.LINKEDIN_JOB_BOARD, cheapJob, {
      scrapedAt,
    });
    if ('invalid' in result) throw new Error(result.invalid);
    expect(result.record).toMatchObject({
      city: null,
      state: null,
      geoId: null,
    });
    expect(result.record.salary?.providedByEmployer ?? null).toBeNull();
  });

  it('keeps an unstated workplace type null', () => {
    expect(map(nullWorkplace).workplaceType).toBeNull();
    expect(map({ ...remote, workplaceType: 'weird' }).workplaceType).toBeNull();
  });

  it('keeps the LinkedIn key for an outside apply URL with no posting identifier', () => {
    const r = map(hybrid);
    const url = (hybrid.applyMethod as { companyApplyUrl: string })
      .companyApplyUrl;
    expect(r.applyUrl).toBe(url);
    const key = jobKey(Channel.LINKEDIN_JOB_BOARD, `id:${hybrid.id}`, r);
    // The URL is a listing page with no posting identifier, so it is not
    // trusted as an identity: the job keeps its LinkedIn id.
    expect(key).toBe('linkedin-job:4471204920');
  });

  it('re-keys the job by an outside apply URL that carries a posting id', () => {
    const r = map(nullWorkplace);
    const url = (nullWorkplace.applyMethod as { companyApplyUrl: string })
      .companyApplyUrl;
    expect(r.applyUrl).toBe(url);
    expect(
      jobKey(Channel.LINKEDIN_JOB_BOARD, `id:${nullWorkplace.id}`, r),
    ).toBe(
      'url:https://wd1.myworkdaysite.com/en-US/recruiting/snapchat/snap/job/Paris-France/Research-Engineer_R0046981-1|Research Engineer',
    );
  });

  it('has no apply URL for Easy Apply, and keys the job by its LinkedIn id', () => {
    const r = map(easyApply);
    expect(r.applyUrl).toBeNull();
    expect(jobKey(Channel.LINKEDIN_JOB_BOARD, `id:${easyApply.id}`, r)).toBe(
      'linkedin-job:4488210322',
    );
  });

  it('takes the outside URL of a ComplexOnsiteApply item', () => {
    expect(map(complexOutside).applyUrl).toBe(
      (complexOutside.applyMethod as { companyApplyUrl: string })
        .companyApplyUrl,
    );
  });

  it('maps the company', () => {
    const r = map(remote);
    const company = remote.company as Record<string, unknown>;
    expect(r.company).toMatchObject({
      linkedinId: company.id,
      website: 'http://www.plexusrs.com/',
      industries: ['Staffing and Recruiting'],
      employeeCountMin: 11,
      employeeCountMax: 50,
      headquartersCountryCode: 'GB',
    });
    expect(r.sector).toBe('Staffing and Recruiting');
    expect(r.companyName).toBe(company.name);
  });

  it('gives no company without an id', () => {
    expect(map({ ...remote, company: null }).company).toBeNull();
    expect(map({ ...remote, company: { name: 'X' } }).company).toBeNull();
  });

  it('keeps the company name and page of a poster with no company id', () => {
    const r = map({ ...remote, company: { name: 'X' } });
    expect(r.company).toBeNull();
    expect(r.companyName).toBe('X');
    expect(r.companyUrl).toBeNull();
    const withPage = map({
      ...remote,
      company: {
        name: 'X',
        linkedinUrl: 'https://www.linkedin.com/company/x/?trk=public_jobs',
      },
    });
    expect(withPage.company).toBeNull();
    expect(withPage.companyUrl).toBe('https://www.linkedin.com/company/x/');
  });

  it('drops bad values', () => {
    expect(
      map({ ...remote, salary: { text: null, min: null, max: null } }).salary,
    ).toBeNull();
    expect(
      map({
        ...remote,
        location: {
          ...(remote.location as object),
          parsed: { countryCode: 'oo' },
        },
      }).countryCode,
    ).toBeNull();
  });

  it('turns the employment type into display text', () => {
    const cases = {
      part_time: 'Part-time',
      contract: 'Contract',
      temporary: 'Temporary',
      internship: 'Internship',
      volunteer: 'Volunteer',
    };
    for (const [type, text] of Object.entries(cases))
      expect(map({ ...remote, employmentType: type }).contractType).toBe(text);
  });
});
