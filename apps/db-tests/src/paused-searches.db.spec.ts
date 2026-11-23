import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import {
  pdfBytes,
  publishProfile,
  resumeKeyFor,
  seedProfile,
  seedSkill,
} from './support/fixtures.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

// Postgres' insufficient_privilege: a column grant refused the write.
const PRIVILEGE = '42501';

describe('searchesResumedAt', () => {
  let user: TestUser;

  const resumedAt = async (): Promise<Date | null> => {
    const { data, error } = await admin()
      .from('users')
      .select('searchesResumedAt')
      .eq('id', user.id)
      .single();
    if (error) throw new Error(error.message);
    const value = (data as { searchesResumedAt: string | null })
      .searchesResumedAt;
    return value === null ? null : new Date(value);
  };
  const clear = async () => {
    const { error } = await admin()
      .from('users')
      .update({ searchesResumedAt: null })
      .eq('id', user.id);
    if (error) throw new Error(error.message);
  };
  const expectJustNow = async () => {
    const at = await resumedAt();
    expect(at).not.toBeNull();
    expect(Math.abs(Date.now() - (at as Date).getTime())).toBeLessThan(5000);
  };

  beforeAll(async () => {
    user = await createTestUser();
  });

  it('edit of a published profile sets searchesResumedAt', async () => {
    const id = await seedProfile(user.id);
    await seedSkill(user.id, id);
    await publishProfile(id);
    await clear();
    const { error } = await user.client
      .from('profiles')
      .update({ yearsOfExperience: 11 })
      .eq('id', id);
    expect(error).toBeNull();
    await expectJustNow();
  });

  it('draft edit and resume-only save leave it null', async () => {
    const draft = await seedProfile(user.id);
    await clear();
    const edited = await user.client
      .from('profiles')
      .update({ yearsOfExperience: 12 })
      .eq('id', draft);
    expect(edited.error).toBeNull();
    expect(await resumedAt()).toBeNull();

    const pub = await seedProfile(user.id);
    await publishProfile(pub);
    await clear();
    const key = resumeKeyFor(user.id, pub);
    const up = await user.client.storage
      .from('resumes')
      .upload(key, pdfBytes(1024), { contentType: 'application/pdf' });
    expect(up.error).toBeNull();
    const saved = await user.client.rpc('set_profile_resume', {
      profile_id: pub,
      key,
      filename: 'cv.pdf',
      sha256: 'a'.repeat(64),
    });
    expect(saved.error).toBeNull();
    expect(await resumedAt()).toBeNull();
  });

  it('replacing skills of a published profile sets it', async () => {
    const id = await seedProfile(user.id);
    await seedSkill(user.id, id);
    await publishProfile(id);
    await clear();
    const { error } = await user.client.rpc('replace_profile_skills', {
      p_profile_id: id,
      p_skills: [
        { technology: 'go', domain: 'devops', mastery: 6, importance: 5 },
      ],
    });
    expect(error).toBeNull();
    await expectJustNow();
  });

  it('owner cannot write searchesResumedAt', async () => {
    const { error } = await user.client
      .from('users')
      .update({ searchesResumedAt: new Date().toISOString() })
      .eq('id', user.id);
    expect(error?.code).toBe(PRIVILEGE);
  });
});
