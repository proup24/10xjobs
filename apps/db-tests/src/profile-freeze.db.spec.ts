import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import { profileFields, seedProfile, seedSkill } from './support/fixtures.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

const PRIVILEGE = '42501';

describe('published profiles are frozen for their owner', () => {
  let a: TestUser;
  let pub: string;
  let pubSkill: string;
  let draft: string;
  let draftSkill: string;

  const row = async (table: string, id: string) => {
    const { data, error } = await admin().from(table).select('*').eq('id', id);
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>[];
  };

  beforeAll(async () => {
    a = await createTestUser();
    pub = await seedProfile(a.id, {
      state: 'published',
      publishedAt: new Date().toISOString(),
    });
    pubSkill = await seedSkill(a.id, pub);
    draft = await seedProfile(a.id);
    draftSkill = await seedSkill(a.id, draft);
  });

  it('does not update a published profile', async () => {
    const before = await row('profiles', pub);
    const { data } = await a.client
      .from('profiles')
      .update({ noticePeriodDays: 90 })
      .eq('id', pub)
      .select();
    expect(data).toEqual([]);
    expect(await row('profiles', pub)).toEqual(before);
  });

  it('does not delete a published profile', async () => {
    await a.client.from('profiles').delete().eq('id', pub);
    expect(await row('profiles', pub)).toHaveLength(1);
  });

  it('does not update a skill of a published profile', async () => {
    const before = await row('profile_skills', pubSkill);
    const { data } = await a.client
      .from('profile_skills')
      .update({ mastery: 1 })
      .eq('id', pubSkill)
      .select();
    expect(data).toEqual([]);
    expect(await row('profile_skills', pubSkill)).toEqual(before);
  });

  it('does not delete a skill of a published profile', async () => {
    await a.client.from('profile_skills').delete().eq('id', pubSkill);
    expect(await row('profile_skills', pubSkill)).toHaveLength(1);
  });

  it('does not insert a skill on a published profile', async () => {
    const id = randomUUID();
    const { error } = await a.client.from('profile_skills').insert({
      id,
      userId: a.id,
      profileId: pub,
      technology: 'go',
      domain: 'backend',
      mastery: 5,
    });
    expect(error?.code).toBe(PRIVILEGE);
    expect(await row('profile_skills', id)).toEqual([]);
  });

  it('does not insert a profile as published', async () => {
    const id = randomUUID();
    const { error } = await a.client
      .from('profiles')
      .insert({ id, ...profileFields(), userId: a.id, state: 'published' });
    expect(error?.code).toBe(PRIVILEGE);
    expect(await row('profiles', id)).toEqual([]);
  });

  it('does not insert a profile with publishedAt', async () => {
    const id = randomUUID();
    const { error } = await a.client.from('profiles').insert({
      id,
      ...profileFields(),
      userId: a.id,
      publishedAt: new Date().toISOString(),
    });
    expect(error?.code).toBe(PRIVILEGE);
    expect(await row('profiles', id)).toEqual([]);
  });

  it('does not insert a profile with a resumeKey', async () => {
    const id = randomUUID();
    const { error } = await a.client.from('profiles').insert({
      id,
      ...profileFields(),
      userId: a.id,
      resumeKey: 'x/resume.pdf',
    });
    expect(error?.code).toBe(PRIVILEGE);
    expect(await row('profiles', id)).toEqual([]);
  });

  it.each([
    ['state', 'published'],
    ['publishedAt', new Date().toISOString()],
    ['resumeKey', 'x/resume.pdf'],
    ['resumeFilename', 'resume.pdf'],
    ['resumeSizeBytes', 1234],
    ['resumeSha256', 'abc123'],
    ['resumeUploadedAt', new Date().toISOString()],
    ['createdAt', '2000-01-01T00:00:00.000Z'],
    ['updatedAt', '2000-01-01T00:00:00.000Z'],
  ])('rejects a user patch of only %s on a draft', async (column, value) => {
    const before = await row('profiles', draft);
    const { error } = await a.client
      .from('profiles')
      .update({ [column]: value })
      .eq('id', draft);
    expect(error?.code).toBe(PRIVILEGE);
    expect(await row('profiles', draft)).toEqual(before);
  });

  it('keeps the draft a draft after the rejected publish attempts', async () => {
    const [r] = await row('profiles', draft);
    expect(r.state).toBe('draft');
    expect(r.publishedAt).toBeNull();
  });

  describe('drafts stay editable', () => {
    it('updates an editable column on a draft', async () => {
      const { data, error } = await a.client
        .from('profiles')
        .update({ position: 'frontend_engineer' })
        .eq('id', draft)
        .select();
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const [r] = await row('profiles', draft);
      expect(r.position).toBe('frontend_engineer');
    });

    it('updates a skill on a draft', async () => {
      const { data, error } = await a.client
        .from('profile_skills')
        .update({ mastery: 3 })
        .eq('id', draftSkill)
        .select();
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const [r] = await row('profile_skills', draftSkill);
      expect(r.mastery).toBe(3);
    });

    it('inserts a skill on a draft', async () => {
      const id = randomUUID();
      const { error } = await a.client.from('profile_skills').insert({
        id,
        userId: a.id,
        profileId: draft,
        technology: 'go',
        domain: 'backend',
        mastery: 5,
      });
      expect(error).toBeNull();
      expect(await row('profile_skills', id)).toHaveLength(1);
    });

    it('deletes a skill on a draft', async () => {
      const ownDraft = await seedProfile(a.id);
      const id = await seedSkill(a.id, ownDraft);
      await a.client.from('profile_skills').delete().eq('id', id);
      expect(await row('profile_skills', id)).toEqual([]);
    });

    it('deletes a draft profile', async () => {
      const id = await seedProfile(a.id);
      await a.client.from('profiles').delete().eq('id', id);
      expect(await row('profiles', id)).toEqual([]);
    });
  });

  it('lets the service role publish a draft', async () => {
    const id = await seedProfile(a.id);
    const { data, error } = await admin()
      .from('profiles')
      .update({ state: 'published', publishedAt: new Date().toISOString() })
      .eq('id', id)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const [r] = await row('profiles', id);
    expect(r.state).toBe('published');
    expect(r.publishedAt).not.toBeNull();
  });
});
