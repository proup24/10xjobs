// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeSupabase } from '@/test/fake-supabase';
import type { Place } from '@/lib/setup/answers';
import {
  MAX_PROFILES,
  loadProfileList,
  profileLabels,
  type ProfileListItem,
} from './profiles';

const position = (c: string) =>
  c === 'backend_engineer' ? 'Backend engineer' : 'Frontend engineer';
const place = (p: Place) => (p.kind === 'region' ? 'Europe' : 'Berlin');
const item = (
  id: string,
  pos: string,
  firstPlace: Place | null = null,
): ProfileListItem => ({ id, position: pos, firstPlace, hasResume: true });
const berlin: Place = { kind: 'country', code: 'DE' };

describe('profileLabels', () => {
  it('uses the plain position when positions are unique', () => {
    const m = profileLabels(
      [item('a', 'backend_engineer'), item('b', 'frontend_engineer')],
      position,
      place,
    );
    expect(m.get('a')).toBe('Backend engineer');
    expect(m.get('b')).toBe('Frontend engineer');
  });

  it('adds the first place when two share a position', () => {
    const m = profileLabels(
      [
        item('a', 'backend_engineer', berlin),
        item('b', 'backend_engineer', { kind: 'region', code: 'EU' }),
        item('c', 'frontend_engineer', berlin),
      ],
      position,
      place,
    );
    expect(m.get('a')).toBe('Backend engineer · Berlin');
    expect(m.get('b')).toBe('Backend engineer · Europe');
    expect(m.get('c')).toBe('Frontend engineer');
  });

  it('numbers later ones when there is no place', () => {
    const m = profileLabels(
      [item('a', 'backend_engineer'), item('b', 'backend_engineer')],
      position,
      place,
    );
    expect(m.get('a')).toBe('Backend engineer');
    expect(m.get('b')).toBe('Backend engineer · 2');
  });

  it('numbers later ones when the place label clashes too', () => {
    const m = profileLabels(
      [
        item('a', 'backend_engineer', berlin),
        item('b', 'backend_engineer', berlin),
        item('c', 'backend_engineer', berlin),
      ],
      position,
      place,
    );
    expect(m.get('a')).toBe('Backend engineer · Berlin');
    expect(m.get('b')).toBe('Backend engineer · Berlin · 2');
    expect(m.get('c')).toBe('Backend engineer · Berlin · 3');
    expect(new Set(m.values()).size).toBe(3);
  });
});

describe('loadProfileList', () => {
  it('maps rows and picks the first place, remote before hybrid before onsite', async () => {
    const f = fakeSupabase({
      reply: () => ({
        data: [
          {
            id: 'a',
            position: 'backend_engineer',
            resumeKey: 'k',
            locations: {
              remote: [],
              hybrid: [{ kind: 'country', code: 'DE' }],
              onsite: [{ kind: 'country', code: 'FR' }],
            },
          },
          {
            id: 'b',
            position: 'frontend_engineer',
            resumeKey: null,
            locations: {
              remote: [{ kind: 'region', code: 'EU' }],
              hybrid: [{ kind: 'country', code: 'DE' }],
              onsite: [],
            },
          },
          { id: 'c', position: 'x', resumeKey: null, locations: null },
        ],
        error: null,
      }),
    });
    expect(await loadProfileList(f.supabase)).toEqual([
      {
        id: 'a',
        position: 'backend_engineer',
        firstPlace: { kind: 'country', code: 'DE' },
        hasResume: true,
      },
      {
        id: 'b',
        position: 'frontend_engineer',
        firstPlace: { kind: 'region', code: 'EU' },
        hasResume: false,
      },
      { id: 'c', position: 'x', firstPlace: null, hasResume: false },
    ]);
    const [q] = f.queries('profiles');
    expect(q.filters.filter(([n]) => n === 'order')).toEqual([
      ['order', 'createdAt', { ascending: true }],
      ['order', 'id', { ascending: true }],
    ]);
  });

  it('throws the load error without data', async () => {
    const f = fakeSupabase({
      reply: () => ({
        data: null,
        error: { code: '42501', message: 'secret' },
      }),
    });
    await expect(loadProfileList(f.supabase)).rejects.toThrow(
      'setup load: profiles read code=42501',
    );
  });
});

it('caps profiles at 5', () => expect(MAX_PROFILES).toBe(5));
