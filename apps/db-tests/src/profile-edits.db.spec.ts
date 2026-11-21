import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import {
  pdfBytes,
  profileFields,
  publishProfile,
  resumeKeyFor,
  seedProfile,
  seedSkill,
} from './support/fixtures.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

// Postgres' insufficient_privilege: a column grant or policy refused the write.
const PRIVILEGE = '42501';

describe('published profiles are editable by their owner', () => {
  let a: TestUser;
  let b: TestUser;

  const row = async (id: string) => {
    const { data, error } = await admin()
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  };
  const skillRows = async (profileId: string) => {
    const { data, error } = await admin()
      .from('profile_skills')
      .select('*')
      .eq('profileId', profileId)
      .order('technology');
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>[];
  };
  const version = async (id: string) =>
    (await row(id))['matchVersion'] as number;

  /** A fresh published profile of `user` with one skill. */
  const published = async (user: TestUser) => {
    const id = await seedProfile(user.id);
    const skillId = await seedSkill(user.id, id);
    await publishProfile(id);
    return { id, skillId };
  };

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
  });

  it('updates a published profile and bumps matchVersion', async () => {
    const pub = (await published(a)).id;
    const before = await version(pub);
    const { data, error } = await a.client
      .from('profiles')
      .update({ noticePeriodDays: 90 })
      .eq('id', pub)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((await row(pub))['noticePeriodDays']).toBe(90);
    expect(await version(pub)).toBe(before + 1);
  });

  it('a save of the same values does not bump', async () => {
    const { id } = await published(a);
    const current = (await row(id))['noticePeriodDays'];
    const before = await version(id);
    const { data, error } = await a.client
      .from('profiles')
      .update({ noticePeriodDays: current })
      .eq('id', id)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await version(id)).toBe(before);
  });

  it('a resume change does not bump', async () => {
    const { id } = await published(a);
    const before = await version(id);
    const key = resumeKeyFor(a.id, id);
    const up = await a.client.storage
      .from('resumes')
      .upload(key, pdfBytes(1024), { contentType: 'application/pdf' });
    expect(up.error).toBeNull();
    const { error } = await a.client.rpc('set_profile_resume', {
      profile_id: id,
      key,
      filename: 'cv.pdf',
      sha256: 'a'.repeat(64),
    });
    expect(error).toBeNull();
    expect((await row(id))['resumeKey']).toBe(key);
    expect(await version(id)).toBe(before);
  });

  it('postSearch does not bump', async () => {
    const { id } = await published(a);
    const before = await version(id);
    const flipped = !(await row(id))['postSearch'];
    const { data, error } = await admin()
      .from('profiles')
      .update({ postSearch: flipped })
      .eq('id', id)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((await row(id))['postSearch']).toBe(flipped);
    expect(await version(id)).toBe(before);
  });

  it('inserting, updating and deleting a skill each bump', async () => {
    const { id, skillId } = await published(a);
    const before = await version(id);

    const inserted = await a.client
      .from('profile_skills')
      .insert({
        id: randomUUID(),
        userId: a.id,
        profileId: id,
        technology: 'go',
        domain: 'backend',
        mastery: 5,
      })
      .select('id')
      .single();
    expect(inserted.error).toBeNull();
    expect(await version(id)).toBe(before + 1);

    const updated = await a.client
      .from('profile_skills')
      .update({ mastery: 2 })
      .eq('id', skillId)
      .select('id');
    expect(updated.error).toBeNull();
    expect(updated.data).toHaveLength(1);
    expect(await version(id)).toBe(before + 2);

    const deleted = await a.client
      .from('profile_skills')
      .delete()
      .eq('id', (inserted.data as { id: string }).id)
      .select('id');
    expect(deleted.error).toBeNull();
    expect(deleted.data).toHaveLength(1);
    expect(await version(id)).toBe(before + 3);
  });

  it('replace_profile_skills works on a published profile', async () => {
    const { id } = await published(a);
    const before = await version(id);
    const stack = [
      { technology: 'go', domain: 'devops', mastery: 6, importance: 5 },
      { technology: 'python', domain: 'data', mastery: 3, importance: 10 },
    ];
    const { error } = await a.client.rpc('replace_profile_skills', {
      p_profile_id: id,
      p_skills: stack,
    });
    expect(error).toBeNull();
    expect((await skillRows(id)).map((s) => s['technology'])).toEqual([
      'go',
      'python',
    ]);
    expect(await version(id)).toBeGreaterThan(before);
  });

  it.each([
    ['state', 'draft'],
    ['publishedAt', '2000-01-01T00:00:00.000Z'],
    ['matchVersion', 99],
    ['searchesVersion', 99],
  ])('cannot set %s', async (column, value) => {
    const { id } = await published(a);
    const before = await row(id);
    const { error } = await a.client
      .from('profiles')
      .update({ [column]: value })
      .eq('id', id);
    expect(error?.code).toBe(PRIVILEGE);
    expect(await row(id)).toEqual(before);
  });

  it.each([
    ['state', 'published'],
    ['publishedAt', '2000-01-01T00:00:00.000Z'],
    ['matchVersion', 99],
    ['searchesVersion', 99],
  ])('rejects a user insert with %s', async (column, value) => {
    const id = randomUUID();
    const { error } = await a.client
      .from('profiles')
      .insert({ id, ...profileFields(), userId: a.id, [column]: value });
    expect(error?.code).toBe(PRIVILEGE);
    const { data } = await admin().from('profiles').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it.each([
    ['resumeKey', 'x/resume.pdf'],
    ['resumeFilename', 'resume.pdf'],
    ['resumeSizeBytes', 1234],
    ['resumeSha256', 'abc123'],
    ['resumeUploadedAt', '2000-01-01T00:00:00.000Z'],
    ['createdAt', '2000-01-01T00:00:00.000Z'],
    ['updatedAt', '2000-01-01T00:00:00.000Z'],
  ])('rejects a user write of only %s on a draft', async (column, value) => {
    const id = await seedProfile(a.id);
    const before = await row(id);
    const { error } = await a.client
      .from('profiles')
      .update({ [column]: value })
      .eq('id', id);
    expect(error?.code).toBe(PRIVILEGE);
    expect(await row(id)).toEqual(before);
    const insertId = randomUUID();
    const ins = await a.client.from('profiles').insert({
      id: insertId,
      ...profileFields(),
      userId: a.id,
      [column]: value,
    });
    expect(ins.error?.code).toBe(PRIVILEGE);
  });

  it('cannot delete a published profile', async () => {
    const { id } = await published(a);
    await a.client.from('profiles').delete().eq('id', id);
    expect(await row(id)).toBeTruthy();
  });

  it('another user cannot update it or its skills', async () => {
    const { id, skillId } = await published(a);
    const profileBefore = await row(id);
    const skillsBefore = await skillRows(id);

    const profile = await b.client
      .from('profiles')
      .update({ noticePeriodDays: 91 })
      .eq('id', id)
      .select();
    expect(profile.error ? [] : profile.data).toEqual([]);
    const skill = await b.client
      .from('profile_skills')
      .update({ mastery: 1 })
      .eq('id', skillId)
      .select();
    expect(skill.error ? [] : skill.data).toEqual([]);
    const gone = await b.client
      .from('profile_skills')
      .delete()
      .eq('id', skillId)
      .select();
    expect(gone.error ? [] : gone.data).toEqual([]);

    expect(await row(id)).toEqual(profileBefore);
    expect(await skillRows(id)).toEqual(skillsBefore);
  });

  it('another user cannot insert a skill onto it', async () => {
    const { id } = await published(a);
    const skillsBefore = await skillRows(id);
    const versionBefore = await version(id);

    for (const userId of [b.id, a.id]) {
      const attempt = await b.client
        .from('profile_skills')
        .insert({
          id: randomUUID(),
          userId,
          profileId: id,
          technology: 'rust',
          domain: 'backend',
          mastery: 5,
        })
        .select();
      expect(attempt.error ? [] : attempt.data).toEqual([]);
    }

    expect(await skillRows(id)).toEqual(skillsBefore);
    expect(await version(id)).toBe(versionBefore);
  });
});
