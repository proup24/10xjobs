import { Channel } from 'src/common/enums';
import { emptyRecord, type NormalizedRecord } from '.';
import { canonicalApplyUrl, jobKey } from './job-key';

const ashbyId = '287770d2-dbc7-4372-adf8-c3e2685d85af';
const liJob = (applyUrl: string | null, id = '4483908744') =>
  jobKey(
    Channel.LINKEDIN_JOB_BOARD,
    `id:${id}`,
    emptyRecord({
      kind: 'job',
      title: 'Engineer',
      applyUrl,
      postingUrl: `https://www.linkedin.com/jobs/view/${id}`,
    }),
  );
const atsItem = (
  channel: Channel.ASHBY | Channel.GREEN_HOUSE,
  sourceKey: string,
  record: Partial<NormalizedRecord> = {},
) =>
  jobKey(
    channel,
    sourceKey,
    emptyRecord({
      kind: 'job',
      postingUrl: 'https://www.affirm.com/careers?gh_jid=1',
      ...record,
    }),
  );

describe('jobKey', () => {
  it('unifies a LinkedIn job with the Ashby posting it applies to', () => {
    const fromLinkedin = liJob(
      `https://jobs.ashbyhq.com/block-labs/${ashbyId}/application?utm_source=linkedin`,
    );
    expect(fromLinkedin).toBe(`ats:ashby/block-labs/${ashbyId}`);
    expect(atsItem(Channel.ASHBY, `posting:block-labs/${ashbyId}`)).toBe(
      fromLinkedin,
    );
  });

  it('unifies a LinkedIn job with the Greenhouse job it applies to', () => {
    expect(
      liJob('https://job-boards.greenhouse.io/affirm/jobs/8016868003'),
    ).toBe(atsItem(Channel.GREEN_HOUSE, 'posting:affirm/8016868003'));
  });

  it('reads a Greenhouse embed URL as its board and job', () => {
    expect(
      liJob(
        'https://app.greenhouse.io/embed/job_app?for=affirm&token=8016868003',
      ),
    ).toBe('ats:greenhouse/affirm/8016868003');
  });

  it('keeps different Greenhouse embed jobs apart', () => {
    expect(
      liJob('https://app.greenhouse.io/embed/job_app?for=a&token=111'),
    ).not.toBe(
      liJob('https://app.greenhouse.io/embed/job_app?for=b&token=222'),
    );
  });

  it('keeps job ids carried in the query apart', () => {
    const a = liJob(
      'https://ibmglobal.avature.net/en_us/careers/jobdetail?jobId=12345&utm_source=x',
    );
    const b = liJob(
      'https://ibmglobal.avature.net/en_us/careers/jobdetail?jobId=67890',
    );
    expect(a).toBe(
      'url:https://ibmglobal.avature.net/en_us/careers/jobdetail?jobId=12345',
    );
    expect(a).not.toBe(b);
  });

  it('unifies tracking and fragment variants of one apply URL', () => {
    const tracked = liJob(
      'https://sii.pl/en/job-ads/id/38247/?sii_source=10&utm_source=linkedin.com&utm_medium=referral#apply-contact-form',
      '1',
    );
    expect(tracked).toBe(
      'url:https://sii.pl/en/job-ads/id/38247?sii_source=10',
    );
    expect(liJob('https://SII.pl/en/job-ads/id/38247?sii_source=10', '2')).toBe(
      tracked,
    );
  });

  it('falls back to the LinkedIn id for an apply URL with no identifier', () => {
    expect(liJob('https://acme.com/careers/')).toBe('linkedin-job:4483908744');
  });

  it('falls back to the LinkedIn id without an apply URL', () => {
    expect(liJob(null)).toBe('linkedin-job:4483908744');
  });

  it('falls back for apply URLs that are not usable web URLs', () => {
    expect(liJob('mailto:jobs@acme.com')).toBe('linkedin-job:4483908744');
    expect(liJob('not a url')).toBe('linkedin-job:4483908744');
    expect(liJob('https://es.linkedin.com/jobs/view/1234567')).toBe(
      'linkedin-job:4483908744',
    );
  });

  it('keeps a post on its own, even with an article link', () => {
    expect(
      jobKey(
        Channel.LINKEDIN_POSTS,
        'id:7390000000000000001',
        emptyRecord({
          kind: 'post',
          descriptionText: 'hiring',
          applyUrl: `https://jobs.ashbyhq.com/acme/${ashbyId}`,
          postingUrl: 'https://www.linkedin.com/posts/x',
        }),
      ),
    ).toBe('linkedin-post:7390000000000000001');
  });

  it('keys an ATS item by its posting, closed or not', () => {
    expect(
      atsItem(Channel.ASHBY, `posting:acme/${ashbyId}`, { closed: true }),
    ).toBe(`ats:ashby/acme/${ashbyId}`);
  });
});

describe('canonicalApplyUrl', () => {
  it('sorts the remaining parameters', () => {
    expect(canonicalApplyUrl('https://a.com/j/12345?b=2&a=1&ref=x&src=y')).toBe(
      'https://a.com/j/12345?a=1&b=2',
    );
  });
});
