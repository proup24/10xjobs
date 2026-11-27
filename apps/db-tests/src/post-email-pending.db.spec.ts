import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import {
  cleanupDetailedJobs,
  postDetail,
  publishProfile,
  seedKeyedListing,
  seedMatchOn,
  seedPost,
  seedPostRole,
  seedProfile,
  type SeededJob,
} from './support/fixtures.js';
import { withCatalog } from './support/pg.js';
import {
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from './support/test-users.js';

afterAll(async () => {
  await cleanupDetailedJobs();
  await cleanupTestUsers();
});

const pending = (userId: string, jobId: string) =>
  withCatalog(async (c) => {
    const { rows } = await c.query<{ pending: boolean }>(
      'select public.post_email_pending($1, $2) as pending',
      [userId, jobId],
    );
    return rows[0].pending;
  });

const contactEmail = (jobId: string) =>
  withCatalog(async (c) => {
    const { rows } = await c.query<{ email: string | null }>(
      'select public.post_role_contact_email($1) as email',
      [jobId],
    );
    return rows[0].email;
  });

describe('post_email_pending', () => {
  let a: TestUser;
  let profileA: string;

  /** A post with one role of key `role`, and that role's job. */
  const roleOf = async (opts: {
    email?: string | null;
    confidence?: 'sure' | 'unsure';
    linkKeys?: string[];
  }): Promise<SeededJob> => {
    const post = await seedPost({
      verdict: 'hiring',
      confidence: opts.confidence,
      roles: [{ roleKey: 'role', email: opts.email ?? null }],
      sources: [
        postDetail({
          authorKey: 'profile:sharer',
          authorName: 'Sam Sharer',
          original: { authorKey: 'profile:orig', authorName: 'Olga Original' },
        }),
      ],
    });
    return seedPostRole(post, 'role', opts.linkKeys ?? []);
  };

  beforeAll(async () => {
    a = await createTestUser();
    profileA = await seedProfile(a.id);
    await publishProfile(profileA);
  });

  it('is true for a qualified role of a sure hiring post that states an email', async () => {
    const role = await roleOf({ email: 'jobs@acme.test' });
    await seedMatchOn(a.id, profileA, role, { outcome: 'qualified' });
    expect(await contactEmail(role.jobId)).toBe('jobs@acme.test');
    expect(await pending(a.id, role.jobId)).toBe(true);
  });

  it('is false without an email', async () => {
    const role = await roleOf({ email: null });
    await seedMatchOn(a.id, profileA, role, { outcome: 'qualified' });
    expect(await contactEmail(role.jobId)).toBeNull();
    expect(await pending(a.id, role.jobId)).toBe(false);
  });

  it('is false for another user, who has no match on the role', async () => {
    const role = await roleOf({ email: 'jobs@acme.test' });
    await seedMatchOn(a.id, profileA, role, { outcome: 'qualified' });
    const b = await createTestUser();
    expect(await pending(b.id, role.jobId)).toBe(false);
  });

  const approve = async (matchId: string, jobId: string) => {
    const { error } = await a.client.from('match_reviews').insert({
      userId: a.id,
      profileId: profileA,
      matchId,
      jobId,
      choice: 'qualified',
      rule: 'hiringVerdict',
      field: 'verdict',
    });
    expect(error).toBeNull();
  };

  it('is false when the verdict is unsure, even with an approved review', async () => {
    const role = await roleOf({
      email: 'jobs@acme.test',
      confidence: 'unsure',
    });
    const matchId = await seedMatchOn(a.id, profileA, role, {
      outcome: 'review',
      review: { rule: 'hiringVerdict', field: 'verdict' },
    });
    await approve(matchId, role.jobId);
    expect(await pending(a.id, role.jobId)).toBe(false);
  });

  it('is true for a review match approved as qualified on a sure verdict', async () => {
    const role = await roleOf({ email: 'jobs@acme.test' });
    const matchId = await seedMatchOn(a.id, profileA, role, {
      outcome: 'review',
      review: { rule: 'seniority', field: 'seniority' },
    });
    expect(await pending(a.id, role.jobId)).toBe(false);
    const { error } = await a.client.from('match_reviews').insert({
      userId: a.id,
      profileId: profileA,
      matchId,
      jobId: role.jobId,
      choice: 'qualified',
      rule: 'seniority',
      field: 'seniority',
    });
    expect(error).toBeNull();
    expect(await pending(a.id, role.jobId)).toBe(true);
  });

  it('is false when the user rescued the role', async () => {
    const role = await roleOf({ email: 'jobs@acme.test' });
    await seedMatchOn(a.id, profileA, role, { outcome: 'qualified' });
    expect(await pending(a.id, role.jobId)).toBe(true);
    const { error } = await admin().from('post_rescues').insert({
      userId: a.id,
      jobId: role.jobId,
      origin: 'disqualified',
      snapshot: {},
    });
    expect(error).toBeNull();
    expect(await pending(a.id, role.jobId)).toBe(false);
  });

  it("is false when the user rescued the role's post from Junk", async () => {
    const post = await seedPost({
      verdict: 'hiring',
      roles: [{ roleKey: 'role', email: 'jobs@acme.test' }],
    });
    const role = await seedPostRole(post, 'role');
    await seedMatchOn(a.id, profileA, role, { outcome: 'qualified' });
    expect(await pending(a.id, role.jobId)).toBe(true);
    const { error } = await admin().from('post_rescues').insert({
      userId: a.id,
      jobId: post.jobId,
      origin: 'junk',
      snapshot: {},
    });
    expect(error).toBeNull();
    expect(await pending(a.id, role.jobId)).toBe(false);
  });

  it('is false when a linked listing has an applied decision', async () => {
    const key = `ats:greenhouse:acme:${randomUUID()}`;
    const listing = await seedKeyedListing({ jobKey: key });
    const role = await roleOf({ email: 'jobs@acme.test', linkKeys: [key] });
    await seedMatchOn(a.id, profileA, role, { outcome: 'qualified' });
    expect(await pending(a.id, role.jobId)).toBe(true);
    const { error } = await admin()
      .from('job_decisions')
      .insert({ userId: a.id, jobId: listing.jobId, status: 'applied' });
    expect(error).toBeNull();
    expect(await pending(a.id, role.jobId)).toBe(false);
  });

  it('is not callable by a signed-in user', async () => {
    const role = await roleOf({ email: 'jobs@acme.test' });
    const { error } = await a.client.rpc(
      'post_email_pending' as never,
      {
        p_user: a.id,
        p_job: role.jobId,
      } as never,
    );
    expect(error).not.toBeNull();
  });
});

describe('post_list_extras', () => {
  it("returns a role's badges and its original author, only for the caller's jobs", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const profileA = await seedProfile(a.id);
    await publishProfile(profileA);
    const post = await seedPost({
      verdict: 'hiring',
      roles: [{ roleKey: 'role', email: 'jobs@acme.test' }],
      sources: [
        postDetail({
          authorKey: 'profile:sharer',
          authorName: 'Sam Sharer',
          original: { authorKey: 'profile:orig', authorName: 'Olga Original' },
        }),
      ],
    });
    const role = await seedPostRole(post, 'role');
    await seedMatchOn(a.id, profileA, role, { outcome: 'qualified' });

    const { data, error } = await a.client.rpc('post_list_extras', {
      p_job_ids: [role.jobId, post.jobId],
    });
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        jobId: role.jobId,
        emailPending: true,
        applyKinds: ['email'],
        authorName: 'Olga Original',
        authorUrl: 'https://www.linkedin.com/in/orig',
        authorKey: 'profile:orig',
        rescued: false,
      },
    ]);

    const other = await b.client.rpc('post_list_extras', {
      p_job_ids: [role.jobId],
    });
    expect(other.error).toBeNull();
    expect(other.data).toEqual([]);
  });
});
