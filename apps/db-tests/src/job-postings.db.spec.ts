import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, anon } from './support/admin.js';
import {
  cleanupDetailedJobs,
  publishProfile,
  seedDetailedJob,
  seedMatchOn,
  seedPostings,
  seedProfile,
  type Posting,
} from './support/fixtures.js';
import {
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from './support/test-users.js';

// Detailed jobs reference the users' profiles, so they go before the users.
afterAll(async () => {
  await cleanupDetailedJobs();
  await cleanupTestUsers();
});

type Row = Record<string, unknown> & { rawItemId: string };

const ANGULAR_EN: Posting = {
  title: 'Senior Angular Developer',
  location: 'Colombia',
  countryCode: 'CO',
  descriptionText: 'Build UIs.',
  postedAt: '2026-11-10T09:00:00.000Z',
};

describe('job_postings', () => {
  let a: TestUser;
  let b: TestUser;
  let profileA: string;

  const postings = async (user: TestUser, jobId: string): Promise<Row[]> => {
    const { data, error } = await user.client.rpc('job_postings', {
      p_job_id: jobId,
    });
    if (error) throw new Error(error.message);
    return data as Row[];
  };

  /** A job with no sources but the given postings, matched for user A. */
  const matchedJob = async (
    list: Posting[],
  ): Promise<{ jobId: string; ids: string[] }> => {
    const job = await seedDetailedJob({ channels: [] });
    const ids = await seedPostings(job.jobId, list);
    await seedMatchOn(a.id, profileA, job);
    return { jobId: job.jobId, ids };
  };

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    profileA = await seedProfile(a.id);
    await publishProfile(profileA);
  });

  it('returns each posting of a merged job with what differs', async () => {
    const { jobId, ids } = await matchedJob([
      ANGULAR_EN,
      {
        title: 'Desarrollador Angular Senior',
        location: 'Colombia',
        countryCode: 'CO',
        descriptionText: 'Build  UIs.\n',
        postedAt: '2026-11-11T09:00:00.000Z',
      },
    ]);
    const rows = await postings(a, jobId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      rawItemId: ids[0],
      channel: 'LINKEDIN_JOB_BOARD',
      title: 'Senior Angular Developer',
      location: 'Colombia',
      shown: true,
      titleDiffers: false,
      placeDiffers: false,
      descriptionDiffers: false,
    });
    expect(rows[0].postingUrl).toMatch(
      /^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+$/,
    );
    expect(new Date(rows[0].postedAt as string).toISOString()).toBe(
      '2026-11-10T09:00:00.000Z',
    );
    expect(rows[1]).toMatchObject({
      rawItemId: ids[1],
      title: 'Desarrollador Angular Senior',
      shown: false,
      titleDiffers: true,
      placeDiffers: false,
      descriptionDiffers: false,
    });
  });

  it('marks a different place and description', async () => {
    const { jobId, ids } = await matchedJob([
      ANGULAR_EN,
      {
        title: 'Senior Angular Developer',
        location: 'Bogotá, Bogotá D.C., Colombia',
        countryCode: 'CO',
        city: 'Bogotá',
        descriptionText: 'Other text.',
      },
    ]);
    const rows = await postings(a, jobId);
    expect(rows.map((r) => r.rawItemId)).toEqual(ids);
    expect(rows[1]).toMatchObject({
      shown: false,
      titleDiffers: false,
      placeDiffers: true,
      descriptionDiffers: true,
    });
  });

  it('treats two missing descriptions as the same', async () => {
    const { jobId } = await matchedJob([
      { ...ANGULAR_EN, descriptionText: null },
      { ...ANGULAR_EN, descriptionText: null, postedAt: null },
    ]);
    const rows = await postings(a, jobId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.descriptionDiffers)).toEqual([false, false]);
  });

  it('lists the shown posting first even when another is older', async () => {
    const { jobId, ids } = await matchedJob([
      { ...ANGULAR_EN, postedAt: '2026-11-12T09:00:00.000Z' },
      {
        ...ANGULAR_EN,
        title: 'Angular Developer',
        postedAt: '2026-11-09T09:00:00.000Z',
      },
      {
        ...ANGULAR_EN,
        title: 'Frontend Developer',
        postedAt: '2026-11-11T09:00:00.000Z',
      },
    ]);
    const rows = await postings(a, jobId);
    expect(rows.map((r) => [r.rawItemId, r.shown])).toEqual([
      [ids[0], true],
      [ids[1], false],
      [ids[2], false],
    ]);
  });

  it('returns one row for a single posting', async () => {
    const { jobId, ids } = await matchedJob([ANGULAR_EN]);
    const rows = await postings(a, jobId);
    expect(rows).toEqual([
      expect.objectContaining({
        rawItemId: ids[0],
        shown: true,
        titleDiffers: false,
        placeDiffers: false,
        descriptionDiffers: false,
      }),
    ]);
  });

  it('returns postings to a user who only has a decision on the job', async () => {
    const job = await seedDetailedJob({ channels: [] });
    const ids = await seedPostings(job.jobId, [ANGULAR_EN]);
    // The insert policy wants a match; a decision whose match is gone is inserted directly.
    const decided = await admin()
      .from('job_decisions')
      .insert({ userId: b.id, jobId: job.jobId, status: 'applied' });
    expect(decided.error).toBeNull();
    const rows = await postings(b, job.jobId);
    expect(rows.map((r) => r.rawItemId)).toEqual(ids);
  });

  it('returns nothing to a user with no match or decision on the job', async () => {
    const { jobId } = await matchedJob([ANGULAR_EN]);
    expect(await postings(a, jobId)).toHaveLength(1);
    expect(await postings(b, jobId)).toEqual([]);
  });

  it('refuses anon', async () => {
    const { jobId } = await matchedJob([ANGULAR_EN]);
    const { data, error } = await anon().rpc('job_postings', {
      p_job_id: jobId,
    });
    expect(data).toBeNull();
    expect(error).toMatchObject({
      code: '42501',
      message: 'permission denied for function job_postings',
    });
  });
});
