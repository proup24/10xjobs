import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

const jobs: string[] = [];

afterAll(async () => {
  if (jobs.length > 0)
    await admin().from('normalized_jobs').delete().in('id', jobs);
  await cleanupTestUsers();
});

/** A post job row, as ingest writes one, with the given postSources (omitted: the default). */
async function seedPostJob(postSources?: unknown): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const { error } = await admin()
    .from('normalized_jobs')
    .insert({
      id,
      jobKey: `test:${id}`,
      kind: 'post',
      status: 'active',
      postingUrl: 'https://www.linkedin.com/posts/test',
      closed: false,
      fieldSources: {},
      firstSeenAt: now,
      lastSeenAt: now,
      normalizerVersion: 8,
      ...(postSources === undefined ? {} : { postSources }),
    });
  if (error) throw new Error(`Could not insert a post job: ${error.message}`);
  jobs.push(id);
  return id;
}

const postSourcesOf = async (id: string) => {
  const { data, error } = await admin()
    .from('normalized_jobs')
    .select('postSources')
    .eq('id', id)
    .single();
  expect(error).toBeNull();
  return data?.postSources;
};

describe('normalized_jobs.postSources', () => {
  let a: TestUser;

  beforeAll(async () => {
    a = await createTestUser();
  });

  it('defaults to null', async () => {
    expect(await postSourcesOf(await seedPostJob())).toBeNull();
  });

  it("stores every source's post details", async () => {
    const value = {
      sources: [
        { id: '7390000000000000001', text: 'We are hiring', original: null },
        { id: '7390000000000000002', text: null, original: { id: '1' } },
      ],
    };
    expect(await postSourcesOf(await seedPostJob(value))).toEqual(value);
  });

  it('is never readable by a signed-in user', async () => {
    const id = await seedPostJob({ sources: [] });
    const { data } = await a.client
      .from('normalized_jobs')
      .select('postSources')
      .eq('id', id);
    expect(data ?? []).toEqual([]);
  });
});
