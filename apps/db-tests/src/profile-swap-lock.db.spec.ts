import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  pdfBytes,
  publishProfile,
  resumeKeyFor,
  seedProfile,
  seedSkill,
} from './support/fixtures.js';
import { withCatalog } from './support/pg.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

const PDF = { contentType: 'application/pdf' };
// Far below the authenticated role's 8 s statement_timeout: a call that waits
// on the lock at all counts as blocked.
const DEADLINE_MS = 2_000;
const BLOCKED = Symbol('blocked');

/** `call`'s outcome, or BLOCKED when it has not settled within DEADLINE_MS. */
async function settle<T>(call: PromiseLike<T>): Promise<T | typeof BLOCKED> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<typeof BLOCKED>((resolve) => {
    timer = setTimeout(() => resolve(BLOCKED), DEADLINE_MS);
  });
  try {
    return await Promise.race([Promise.resolve(call), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `fn` while another session holds `mode` on the profile row, the way the
 * engine's search swap holds FOR KEY SHARE for its whole run; commits after.
 */
async function whileLocked<T>(
  profileId: string,
  mode: 'FOR KEY SHARE' | 'FOR NO KEY UPDATE',
  fn: () => Promise<T>,
): Promise<T> {
  return withCatalog(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `SELECT 1 FROM public.profiles WHERE id = $1 ${mode}`,
        [profileId],
      );
      return await fn();
    } finally {
      await client.query('COMMIT');
    }
  });
}

describe('profile writes during a search swap', () => {
  let a: TestUser;

  const published = async () => {
    const id = await seedProfile(a.id);
    await seedSkill(a.id, id);
    await publishProfile(id);
    return id;
  };

  const replaceSkills = (id: string) =>
    a.client.rpc('replace_profile_skills', {
      p_profile_id: id,
      p_skills: [
        { technology: 'go', domain: 'devops', mastery: 6, importance: 5 },
      ],
    });

  beforeAll(async () => {
    a = await createTestUser();
  });

  it('replace_profile_skills does not wait for a swap', async () => {
    const id = await published();
    const outcome = await whileLocked(id, 'FOR KEY SHARE', () =>
      settle(replaceSkills(id)),
    );
    expect(outcome).not.toBe(BLOCKED);
    expect(outcome === BLOCKED ? null : outcome.error).toBeNull();
  });

  it('replace_profile_skills still waits for another skill replace', async () => {
    const id = await published();
    // One promise, so the request is sent once (a builder sends on every then).
    let pending: Promise<Awaited<ReturnType<typeof replaceSkills>>> | undefined;
    const outcome = await whileLocked(id, 'FOR NO KEY UPDATE', () => {
      pending = Promise.resolve(replaceSkills(id));
      return settle(pending);
    });
    expect(outcome).toBe(BLOCKED);
    // Released: the waiting call now goes through.
    expect((await pending!).error).toBeNull();
  });

  it('set_profile_resume does not wait for a swap', async () => {
    const id = await published();
    const key = resumeKeyFor(a.id, id);
    const { error: uploadError } = await a.client.storage
      .from('resumes')
      .upload(key, pdfBytes(), PDF);
    if (uploadError) throw new Error(uploadError.message);
    const outcome = await whileLocked(id, 'FOR KEY SHARE', () =>
      settle(
        a.client.rpc('set_profile_resume', {
          profile_id: id,
          key,
          filename: 'cv.pdf',
          sha256: 'a'.repeat(64),
        }),
      ),
    );
    expect(outcome).not.toBe(BLOCKED);
    expect(outcome === BLOCKED ? null : outcome.error).toBeNull();
  });
});
