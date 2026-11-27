import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupDetailedJobs,
  publishProfile,
  seedLinkedRole,
  seedMatchOn,
  seedProfile,
} from './support/fixtures.js';
import {
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from './support/test-users.js';

afterAll(async () => {
  await cleanupDetailedJobs();
  await cleanupTestUsers();
});

describe('post_rescue', () => {
  let a: TestUser;
  let b: TestUser;
  let job: string;
  let qualifiedJob: string;

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    const profileA = await seedProfile(a.id);
    await publishProfile(profileA);
    const profileB = await seedProfile(b.id);
    await publishProfile(profileB);
    const role = await seedLinkedRole([]);
    job = role.jobId;
    await seedMatchOn(a.id, profileA, role, {
      outcome: 'rejected',
      checks: [{ rule: 'seniority', outcome: 'fail', reason: 'too junior' }],
    });
    await seedMatchOn(b.id, profileB, role, {
      outcome: 'rejected',
      checks: [{ rule: 'stack', outcome: 'fail', reason: 'no match' }],
    });
    const qualified = await seedLinkedRole([]);
    qualifiedJob = qualified.jobId;
    await seedMatchOn(a.id, profileA, qualified, { outcome: 'qualified' });
  });

  const rescuesOf = async (user: TestUser) => {
    const { data, error } = await user.client.from('post_rescues').select('*');
    expect(error).toBeNull();
    return data ?? [];
  };

  it('rescues a rejected post role and snapshots the failed checks', async () => {
    const { data: id, error } = await a.client.rpc('post_rescue', {
      p_job_id: job,
    });
    expect(error).toBeNull();
    expect(id).toBeTruthy();
    const rows = await rescuesOf(a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      jobId: job,
      origin: 'disqualified',
      undoneAt: null,
    });
    const snapshot = rows[0].snapshot as {
      profiles: { failed: { rule: string }[] }[];
    };
    expect(snapshot.profiles[0].failed[0].rule).toBe('seniority');
  });

  it('a second call returns the same id', async () => {
    const first = await a.client.rpc('post_rescue', { p_job_id: job });
    const second = await a.client.rpc('post_rescue', { p_job_id: job });
    expect(first.error).toBeNull();
    expect(second.data).toBe(first.data);
    expect(await rescuesOf(a)).toHaveLength(1);
  });

  it('another user cannot read the rescue, and a rescue changes nothing for them', async () => {
    expect(await rescuesOf(b)).toEqual([]);
    const { data } = await b.client
      .from('job_matches')
      .select('outcome')
      .eq('jobId', job);
    expect(data).toEqual([{ outcome: 'rejected' }]);
    const details = await b.client.rpc('match_details', {
      p_outcome: 'rejected',
      p_job_id: job,
      p_kind: 'post_role',
    });
    expect(details.error).toBeNull();
    expect(details.data).toHaveLength(1);
  });

  it('refuses a user with no rejected match on the job', async () => {
    const other = await createTestUser();
    const { error } = await other.client.rpc('post_rescue', { p_job_id: job });
    expect(error?.message).toContain('not rescuable');
  });

  it('refuses a direct insert', async () => {
    const { error } = await a.client.from('post_rescues').insert({
      userId: a.id,
      jobId: qualifiedJob,
      origin: 'junk',
      snapshot: {},
    });
    expect(error?.code).toBe('42501');
  });

  it('refuses a job whose match is qualified', async () => {
    const { error } = await a.client.rpc('post_rescue', {
      p_job_id: qualifiedJob,
    });
    expect(error?.message).toContain('not rescuable');
  });

  it('undo marks the row, and a new rescue makes a new row', async () => {
    const before = await a.client.rpc('post_rescue', { p_job_id: job });
    const undo = await a.client.rpc('post_rescue_undo', { p_job_id: job });
    expect(undo.error).toBeNull();
    const rows = await rescuesOf(a);
    expect(rows).toHaveLength(1);
    expect(rows[0].undoneAt).not.toBeNull();
    const again = await a.client.rpc('post_rescue', { p_job_id: job });
    expect(again.error).toBeNull();
    expect(again.data).not.toBe(before.data);
    expect(await rescuesOf(a)).toHaveLength(2);
  });

  it('undo after a decision raises decided', async () => {
    const insert = await a.client
      .from('job_decisions')
      .insert({ userId: a.id, jobId: job, status: 'applied' });
    expect(insert.error).toBeNull();
    const { error } = await a.client.rpc('post_rescue_undo', { p_job_id: job });
    expect(error?.message).toContain('decided');
  });
});
