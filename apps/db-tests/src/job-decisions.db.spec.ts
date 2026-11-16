import { DISMISS_REASONS } from '@xjobs/database/enums';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, anon } from './support/admin.js';
import {
  cleanupDetailedJobs,
  publishProfile,
  seedDetailedJob,
  seedMatchOn,
  seedProfile,
} from './support/fixtures.js';
import { withCatalog } from './support/pg.js';
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

describe('job_decisions', () => {
  let a: TestUser;
  let b: TestUser;
  let profileA: string;
  let job: string;
  let second: string;
  let other: string;

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    profileA = await seedProfile(a.id);
    await publishProfile(profileA);
    const matched = await seedDetailedJob();
    await seedMatchOn(a.id, profileA, matched);
    job = matched.jobId;
    const matchedToo = await seedDetailedJob();
    await seedMatchOn(a.id, profileA, matchedToo);
    second = matchedToo.jobId;
    other = (await seedDetailedJob()).jobId;
  });

  // Each test starts from no decisions.
  const clear = async () => {
    const { error } = await admin()
      .from('job_decisions')
      .delete()
      .eq('userId', a.id);
    expect(error).toBeNull();
  };

  const decisionsOf = async (user: TestUser) => {
    const { data, error } = await user.client.from('job_decisions').select('*');
    expect(error).toBeNull();
    return data ?? [];
  };

  it('the owner marks, reads, changes and clears a decision', async () => {
    await clear();
    const insert = await a.client
      .from('job_decisions')
      .insert({ userId: a.id, jobId: job, status: 'applied' });
    expect(insert.error).toBeNull();
    const rows = await decisionsOf(a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: a.id, jobId: job });

    const update = await a.client
      .from('job_decisions')
      .update({ status: 'dismissed', reason: 'stack', note: 'Java' })
      .eq('jobId', job);
    expect(update.error).toBeNull();
    expect(await decisionsOf(a)).toMatchObject([
      { status: 'dismissed', reason: 'stack', note: 'Java' },
    ]);

    const del = await a.client.from('job_decisions').delete().eq('jobId', job);
    expect(del.error).toBeNull();
    expect(await decisionsOf(a)).toEqual([]);
  });

  it('one decision per user and job', async () => {
    await clear();
    const row = { userId: a.id, jobId: job, status: 'applied' };
    expect((await a.client.from('job_decisions').insert(row)).error).toBeNull();
    const { error } = await a.client.from('job_decisions').insert(row);
    expect(error?.code).toBe('23505');
  });

  it('refuses a decision on an unmatched job', async () => {
    await clear();
    const { error } = await a.client
      .from('job_decisions')
      .insert({ userId: a.id, jobId: other, status: 'applied' });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('refuses a decision for someone else', async () => {
    await clear();
    const { error } = await a.client
      .from('job_decisions')
      .insert({ userId: b.id, jobId: job, status: 'applied' });
    expect(error).not.toBeNull();
  });

  it('still updates after the match is gone', async () => {
    await clear();
    const insert = await a.client
      .from('job_decisions')
      .insert({ userId: a.id, jobId: second, status: 'applied' });
    expect(insert.error).toBeNull();
    const gone = await admin()
      .from('job_matches')
      .delete()
      .eq('userId', a.id)
      .eq('jobId', second);
    expect(gone.error).toBeNull();
    const { error } = await a.client
      .from('job_decisions')
      .update({ status: 'dismissed' })
      .eq('jobId', second);
    expect(error).toBeNull();
    expect(await decisionsOf(a)).toMatchObject([{ status: 'dismissed' }]);
  });

  it('the job and user cannot change', async () => {
    await clear();
    expect(
      (
        await a.client
          .from('job_decisions')
          .insert({ userId: a.id, jobId: job, status: 'applied' })
      ).error,
    ).toBeNull();
    const jobChange = await a.client
      .from('job_decisions')
      .update({ jobId: other })
      .eq('jobId', job);
    expect(jobChange.error).not.toBeNull();
    expect(jobChange.error?.code).toBe('42501');
    const userChange = await a.client
      .from('job_decisions')
      .update({ userId: b.id })
      .eq('jobId', job);
    expect(userChange.error?.code).toBe('42501');
  });

  it('applied carries no reason', async () => {
    await clear();
    const { error } = await a.client
      .from('job_decisions')
      .insert({ userId: a.id, jobId: job, status: 'applied', reason: 'stack' });
    expect(error?.code).toBe('23514');
  });

  it('rejects an unknown reason and a note over 500 characters', async () => {
    await clear();
    const unknown = await a.client.from('job_decisions').insert({
      userId: a.id,
      jobId: job,
      status: 'dismissed',
      reason: 'boring',
    });
    expect(unknown.error?.code).toBe('23514');
    const long = await a.client.from('job_decisions').insert({
      userId: a.id,
      jobId: job,
      status: 'dismissed',
      note: 'x'.repeat(501),
    });
    expect(long.error?.code).toBe('23514');
  });

  it('the reason check matches DISMISS_REASONS', async () => {
    const definition = await withCatalog(async (client) => {
      const { rows } = await client.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE conname LIKE 'job_decisions_reason%'`,
      );
      return rows[0]?.def ?? '';
    });
    const quoted = [...definition.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(quoted)].sort()).toEqual([...DISMISS_REASONS].sort());
  });

  it("hides other users' decisions", async () => {
    await clear();
    expect(
      (
        await a.client
          .from('job_decisions')
          .insert({ userId: a.id, jobId: job, status: 'applied' })
      ).error,
    ).toBeNull();
    expect(await decisionsOf(b)).toEqual([]);
  });

  it('anonymous callers see and write nothing', async () => {
    const read = await anon().from('job_decisions').select('*');
    expect(read.error ? [] : read.data).toEqual([]);
    const write = await anon()
      .from('job_decisions')
      .insert({ userId: a.id, jobId: job, status: 'applied' });
    expect(write.error).not.toBeNull();
  });

  it('decisions go with the job', async () => {
    await clear();
    expect(
      (
        await a.client
          .from('job_decisions')
          .insert({ userId: a.id, jobId: job, status: 'applied' })
      ).error,
    ).toBeNull();
    // The fixtures remove the job's sources, extractions and matches first, then the job.
    await cleanupDetailedJobs();
    const { data } = await admin()
      .from('job_decisions')
      .select('id')
      .eq('jobId', job);
    expect(data).toEqual([]);
  });
});
