import { describe, expect, it, vi } from 'vitest';
import {
  blockAuthor,
  loadBlockedAuthors,
  parseAuthorLink,
  unblockAuthor,
} from './blocked-authors';

describe('parseAuthorLink', () => {
  it.each([
    ['https://www.linkedin.com/in/Jane-Doe/?utm_source=x', 'profile:jane-doe'],
    ['linkedin.com/in/j%C3%A9r%C3%B4me', 'profile:jérôme'],
    ['https://fr.linkedin.com/company/Acme-Inc/posts/', 'company:acme-inc'],
    ['  HTTP://WWW.LINKEDIN.COM/IN/jane///#top ', 'profile:jane'],
    ['www.linkedin.com/company/acme', 'company:acme'],
  ])('%s gives %s', (input, key) => {
    expect(parseAuthorLink(input)?.authorKey).toBe(key);
  });

  it('builds a canonical profile url', () => {
    expect(parseAuthorLink('linkedin.com/in/Jane-Doe?x=1')?.profileUrl).toBe(
      'https://www.linkedin.com/in/Jane-Doe/',
    );
    expect(parseAuthorLink('uk.linkedin.com/company/Acme/')?.profileUrl).toBe(
      'https://www.linkedin.com/company/Acme/',
    );
  });

  it.each([
    'https://www.linkedin.com/feed/',
    'https://example.com/in/jane',
    'https://notlinkedin.com/in/jane',
    'https://linkedin.com.evil.com/in/jane',
    'https://www.linkedin.com/in/',
    'https://www.linkedin.com/in/%E0%A4%A',
    '',
    'not a link',
  ])('%s gives null', (input) => {
    expect(parseAuthorLink(input)).toBeNull();
  });
});

function client(result: { error: { code?: string } | null; data?: unknown }) {
  const insert = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockResolvedValue(result);
  const del = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ insert, delete: del }));
  return { supabase: { from } as never, from, insert, del, eq };
}

describe('blockAuthor', () => {
  it('inserts the key, url and name, with no id', async () => {
    const c = client({ error: null });
    const r = await blockAuthor(c.supabase, 'u1', {
      authorKey: 'profile:jane',
      name: 'Jane',
      profileUrl: 'https://www.linkedin.com/in/jane/',
    });
    expect(r).toEqual({ status: 'saved' });
    expect(c.from).toHaveBeenCalledWith('blocked_authors');
    expect(c.insert).toHaveBeenCalledWith({
      userId: 'u1',
      authorKey: 'profile:jane',
      name: 'Jane',
      profileUrl: 'https://www.linkedin.com/in/jane/',
    });
    expect(c.insert.mock.calls[0][0]).not.toHaveProperty('id');
  });

  it('takes a pasted link', async () => {
    const c = client({ error: null });
    await blockAuthor(c.supabase, 'u1', {
      link: 'linkedin.com/company/Acme/?utm=1',
    });
    expect(c.insert).toHaveBeenCalledWith({
      userId: 'u1',
      authorKey: 'company:acme',
      name: null,
      profileUrl: 'https://www.linkedin.com/company/Acme/',
    });
  });

  it('refuses an invalid link without writing', async () => {
    const c = client({ error: null });
    const r = await blockAuthor(c.supabase, 'u1', {
      link: 'https://example.com/in/x',
    });
    expect(r).toEqual({
      status: 'invalid',
      errors: { _form: 'Paste a LinkedIn profile or company link.' },
    });
    expect(c.insert).not.toHaveBeenCalled();
  });

  it('refuses a malformed input and a non-https profileUrl', async () => {
    const c = client({ error: null });
    expect((await blockAuthor(c.supabase, 'u1', null)).status).toBe('invalid');
    expect(
      (await blockAuthor(c.supabase, 'u1', { authorKey: 'x:y' })).status,
    ).toBe('invalid');
    await blockAuthor(c.supabase, 'u1', {
      authorKey: 'profile:a',
      profileUrl: 'javascript:alert(1)',
    });
    expect(c.insert.mock.calls[0][0].profileUrl).toBeNull();
  });

  it('counts a duplicate as saved', async () => {
    const c = client({ error: { code: '23505' } });
    expect(
      await blockAuthor(c.supabase, 'u1', { link: 'linkedin.com/in/a' }),
    ).toEqual({
      status: 'saved',
    });
  });

  it('fails on another error and logs the code only', async () => {
    const c = client({ error: { code: '42501' } });
    const log = vi.fn();
    const r = await blockAuthor(
      c.supabase,
      'u1',
      { link: 'linkedin.com/in/a' },
      { log },
    );
    expect(r).toEqual({ status: 'failed' });
    expect(log.mock.calls[0][0]).toContain('42501');
    expect(log.mock.calls[0][0]).not.toContain('linkedin');
  });
});

describe('unblockAuthor', () => {
  it('deletes by key', async () => {
    const c = client({ error: null });
    expect(await unblockAuthor(c.supabase, 'profile:jane')).toEqual({
      status: 'saved',
    });
    expect(c.eq).toHaveBeenCalledWith('authorKey', 'profile:jane');
  });
  it('fails on a non-string key', async () => {
    const c = client({ error: null });
    expect(await unblockAuthor(c.supabase, 5)).toEqual({ status: 'failed' });
    expect(c.del).not.toHaveBeenCalled();
  });
  it('fails on a database error', async () => {
    const c = client({ error: { code: 'x' } });
    expect(
      await unblockAuthor(c.supabase, 'profile:a', { log: () => undefined }),
    ).toEqual({ status: 'failed' });
  });
});

describe('loadBlockedAuthors', () => {
  it('reads newest first', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          authorKey: 'profile:a',
          name: null,
          profileUrl: null,
          createdAt: 't',
        },
      ],
      error: null,
    });
    const select = vi.fn(() => ({ order }));
    const supabase = { from: vi.fn(() => ({ select })) } as never;
    expect(await loadBlockedAuthors(supabase)).toEqual([
      { authorKey: 'profile:a', name: null, profileUrl: null, createdAt: 't' },
    ]);
    expect(order).toHaveBeenCalledWith('createdAt', { ascending: false });
  });
});
