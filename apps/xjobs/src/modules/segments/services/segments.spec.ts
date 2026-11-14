import { Arrangement, Channel, SkillDomain } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import {
  linkedinGroupKey,
  mergedLinkedinKeyword,
} from 'src/modules/collectors/providers/mappers/linkedin-job-board.mapper';
import { linkedinKeywordFits } from 'src/modules/queries/channels/linkedin_keyword';
import { buildSegments, segmentHash, segmentKey } from './segments';
import { segmentWindow } from './window';

let n = 0;
const builder = (
  overrides: Partial<QuerySearchBuilderRow> = {},
): QuerySearchBuilderRow =>
  ({
    id: `qs-${++n}`,
    hash: `h-${String(n).padStart(3, '0')}`,
    channel: Channel.LINKEDIN_JOB_BOARD,
    domain: SkillDomain.backend,
    type: Arrangement.onsite,
    location: 'casablanca, morocco',
    keyword: 'backend',
    ...overrides,
    params:
      (overrides.channel ?? Channel.LINKEDIN_JOB_BOARD) ===
      Channel.LINKEDIN_JOB_BOARD
        ? {
            roleWords: ['backend'],
            spellings: ['nestjs'],
            ...(overrides.params as object),
          }
        : (overrides.params ?? {}),
  }) as QuerySearchBuilderRow;

const many = (count: number, overrides: Partial<QuerySearchBuilderRow> = {}) =>
  Array.from({ length: count }, () => builder(overrides));

describe('buildSegments', () => {
  it('cuts a group into segments of at most 10', () => {
    const segments = buildSegments(many(25, { channel: Channel.ASHBY }));
    expect(segments.map((s) => s.members.length)).toEqual([10, 10, 5]);
    expect(new Set(segments.map((s) => s.key)).size).toBe(1);
    expect(new Set(segments.map((s) => s.hash)).size).toBe(3);
  });

  it('keeps onsite and hybrid apart in the same city', () => {
    const segments = buildSegments([
      ...many(2),
      ...many(2, { type: Arrangement.hybrid }),
    ]);
    expect(segments).toHaveLength(2);
  });

  it('keeps domains and locations apart', () => {
    const segments = buildSegments([
      ...many(2, { channel: Channel.ASHBY }),
      ...many(2, { channel: Channel.ASHBY, domain: SkillDomain.frontend }),
      ...many(2, { channel: Channel.ASHBY, location: 'rabat, morocco' }),
    ]);
    expect(segments).toHaveLength(3);
  });

  it('groups onsite builders of one location, whatever kind of place it is', () => {
    const segments = buildSegments(
      many(3, { channel: Channel.GREEN_HOUSE, location: 'europe' }),
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].key).toBe(
      `${Channel.GREEN_HOUSE}|backend|onsite|europe`,
    );
  });

  it('keeps one location apart across arrangements', () => {
    const segments = buildSegments([
      ...many(2, { channel: Channel.ASHBY, location: 'france' }),
      ...many(2, {
        channel: Channel.ASHBY,
        location: 'france',
        type: Arrangement.hybrid,
      }),
    ]);
    expect(segments).toHaveLength(2);
  });

  it('never mixes channels', () => {
    const segments = buildSegments([
      ...many(2),
      ...many(2, { channel: Channel.LINKEDIN_POSTS }),
    ]);
    expect(segments.map((s) => s.channel).sort()).toEqual([
      Channel.LINKEDIN_JOB_BOARD,
      Channel.LINKEDIN_POSTS,
    ]);
  });

  it('gives the same segments whatever the input order', () => {
    const builders = many(23, { channel: Channel.ASHBY });
    const shuffled = [...builders].reverse();
    const shape = (rows: QuerySearchBuilderRow[]) =>
      buildSegments(rows).map((s) => ({
        key: s.key,
        hash: s.hash,
        ids: s.members.map((m) => m.id),
      }));
    expect(shape(shuffled)).toEqual(shape(builders));
    expect(shape(builders)[0].ids).toEqual(
      [...builders]
        .sort((a, b) => (a.hash < b.hash ? -1 : 1))
        .slice(0, 10)
        .map((b) => b.id),
    );
  });

  it('groups LinkedIn builders that search the same place, whatever their location', () => {
    const remote = { type: Arrangement.remote };
    const segments = buildSegments([
      builder({
        ...remote,
        location: 'emea',
        params: { location: 'EMEA' },
      }),
      builder({
        ...remote,
        location: 'mena',
        params: { location: 'EMEA' },
      }),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].members).toHaveLength(2);
  });

  it('groups LinkedIn builders by geoId before location text', () => {
    const remote = { type: Arrangement.remote };
    const segments = buildSegments([
      builder({
        ...remote,
        location: 'emea',
        params: { location: 'EMEA', geoId: '91000007' },
      }),
      builder({
        ...remote,
        location: 'mena',
        params: {
          location: 'Europe, Middle East and Africa',
          geoId: '91000007',
        },
      }),
    ]);
    expect(segments).toHaveLength(1);
  });

  it('keys channels other than the LinkedIn job board on the location', () => {
    const b = builder({
      channel: Channel.ASHBY,
      type: Arrangement.remote,
      location: 'mena',
      params: { location: 'EMEA' },
    });
    expect(segmentKey(b)).toBe(`${Channel.ASHBY}|backend|remote|mena`);
  });

  it('keys a LinkedIn job board builder by its group, with the geoId before location text', () => {
    expect(segmentKey(builder({ params: { location: 'emea' } }))).toBe(
      `${Channel.LINKEDIN_JOB_BOARD}|onsite|group:${linkedinGroupKey({ location: 'emea' })}`,
    );
    expect(
      segmentKey(
        builder({
          params: {
            location: 'emea',
            geoId: '91000000',
            experienceLevel: '4',
            workType: '2',
          },
        }),
      ),
    ).toBe(
      `${Channel.LINKEDIN_JOB_BOARD}|onsite|group:${linkedinGroupKey({ location: 'emea', geoId: '91000000', experienceLevel: '4', workType: '2' })}`,
    );
  });

  it('groups LinkedIn builders of one search whatever their keyword', () => {
    const base = { location: 'Germany' };
    const segments = buildSegments([
      builder({
        params: { ...base, roleWords: ['backend'], spellings: ['go'] },
      }),
      builder({
        params: { ...base, roleWords: ['developer'], spellings: ['rust'] },
      }),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].members).toHaveLength(2);
  });

  it('keeps levels and work types apart', () => {
    const base = { location: 'Germany' };
    const segments = buildSegments([
      builder({ params: base }),
      builder({ params: { ...base, experienceLevel: '4' } }),
      builder({ params: { ...base, workType: '2' } }),
      builder({ params: { location: 'France' } }),
    ]);
    expect(segments).toHaveLength(4);
  });

  it('ignores domain for the LinkedIn job board', () => {
    const segments = buildSegments([
      builder({ domain: SkillDomain.backend }),
      builder({ domain: SkillDomain.frontend }),
    ]);
    expect(segments).toHaveLength(1);
  });

  it('cuts a group into parts chunks, stable by hash', () => {
    const builders = many(7);
    const key = segmentKey(builders[0]);
    const segments = buildSegments(builders, 10, new Map([[key, 3]]));
    expect(segments.map((s) => s.members.length)).toEqual([3, 2, 2]);
    const sorted = [...builders].sort((a, b) => (a.hash < b.hash ? -1 : 1));
    expect(segments.flatMap((s) => s.members.map((m) => m.id))).toEqual(
      sorted.map((m) => m.id),
    );
    const again = buildSegments(
      [...builders].reverse(),
      10,
      new Map([[key, 3]]),
    );
    expect(again.map((s) => s.hash)).toEqual(segments.map((s) => s.hash));
  });

  it('cuts a group whose merged keyword is too long', () => {
    const builders = Array.from({ length: 30 }, (_, i) =>
      builder({
        params: {
          roleWords: ['backend'],
          spellings: [`technology-number-${i}`],
        },
      }),
    );
    const segments = buildSegments(builders);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.flatMap((s) => s.members)).toHaveLength(30);
    for (const s of segments)
      expect(
        linkedinKeywordFits(
          ['backend'],
          s.members.map((m) => (m.params as any).spellings[0]),
        ),
      ).toBe(true);
  });

  it('keeps a single over-long builder alone', () => {
    const long = builder({
      params: {
        roleWords: ['backend'],
        spellings: Array.from({ length: 40 }, (_, i) => `technology-${i}`),
      },
    });
    const segments = buildSegments([long, builder()]);
    expect(segments.find((s) => s.members.includes(long))?.members).toEqual([
      long,
    ]);
  });

  it('merges the dev profile Europe remote builder with user B into one segment', () => {
    const europeRemote = (roleWords: string[], spellings: string[]) =>
      builder({
        type: Arrangement.remote,
        location: 'europe',
        params: {
          location: 'europe',
          workType: '2',
          experienceLevel: '4',
          roleWords,
          spellings,
        },
      });
    const dev = europeRemote(['backend'], ['nestjs', 'typescript']);
    const userB = europeRemote(['backend'], ['python']);
    const segments = buildSegments([dev, userB]);
    expect(segments).toHaveLength(1);
    expect(
      mergedLinkedinKeyword(segments[0].members as { params: any }[]),
    ).toContain('python');
  });

  it('keeps user C Morocco onsite levels apart from other segments', () => {
    const casa = (level: string, spellings: string[]) =>
      builder({
        params: {
          location: 'morocco',
          workType: '1',
          experienceLevel: level,
          roleWords: ['developer'],
          spellings,
        },
      });
    const europe = builder({
      type: Arrangement.remote,
      params: {
        location: 'europe',
        workType: '2',
        experienceLevel: '4',
        roleWords: ['backend'],
        spellings: ['nestjs'],
      },
    });
    const segments = buildSegments([
      europe,
      casa('1', ['java']),
      casa('2', ['java']),
    ]);
    expect(segments).toHaveLength(3);
    for (const s of segments) expect(s.members).toHaveLength(1);
  });

  it('shares one segment between European Union and Europe preferences', () => {
    const segments = buildSegments([
      builder({ location: 'europe', params: { location: 'europe' } }),
      builder({ location: 'european union', params: { location: 'europe' } }),
    ]);
    expect(segments).toHaveLength(1);
  });

  it('gives a LinkedIn builder with an unknown place a segment of its own, apart from real searches', () => {
    const good = builder({ params: { location: 'emea' } });
    const bad = builder({ params: { location: 'atlantis' } });
    const segments = buildSegments([good, bad]);
    expect(segments).toHaveLength(2);
    const unresolved = segments.find((s) => s.members[0].id === bad.id);
    expect(unresolved?.key).toBe(
      `${Channel.LINKEDIN_JOB_BOARD}|onsite|unresolved:${bad.id}`,
    );
    expect(unresolved?.members).toEqual([bad]);
  });

  it('keeps each member cursor when builders are regrouped', () => {
    const remote = { type: Arrangement.remote };
    const until = new Date('2026-11-01T12:00:00Z');
    const [merged] = buildSegments([
      builder({
        ...remote,
        location: 'emea',
        params: { location: 'EMEA' },
        coveredUntil: new Date('2026-11-01T11:00:00Z'),
      }),
      builder({
        ...remote,
        location: 'mena',
        params: { location: 'EMEA' },
        coveredUntil: new Date('2026-11-01T10:00:00Z'),
      }),
    ]);
    const window = segmentWindow(merged.members, until, {
      initialHours: 24,
      overlapMinutes: 15,
      maximumHours: 24,
    });
    expect(window.since).toEqual(new Date('2026-11-01T09:45:00Z'));
  });
});

describe('segmentHash', () => {
  it('matches the hash buildSegments assigns', () => {
    const segments = buildSegments(many(13, { channel: Channel.ASHBY }));
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments)
      expect(
        segmentHash(
          segment.key,
          segment.members.map((member) => member.id),
        ),
      ).toBe(segment.hash);
  });
});
