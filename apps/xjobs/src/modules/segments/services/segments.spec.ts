import { Arrangement, Channel, Region, SkillDomain } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import { buildSegments, segmentKey } from './segments';
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
    country: 'MA',
    city: 'Casablanca',
    locationRegion: null,
    keyword: `kw ${n}`,
    params: {},
    ...overrides,
  }) as QuerySearchBuilderRow;

const many = (count: number, overrides: Partial<QuerySearchBuilderRow> = {}) =>
  Array.from({ length: count }, () => builder(overrides));

describe('buildSegments', () => {
  it('cuts a group into segments of at most 10', () => {
    const segments = buildSegments(many(25));
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

  it('keeps domains and cities apart', () => {
    const segments = buildSegments([
      ...many(2),
      ...many(2, { domain: SkillDomain.frontend }),
      ...many(2, { city: 'Rabat' }),
    ]);
    expect(segments).toHaveLength(3);
  });

  it('groups remote builders by region, ignoring city, with GLOBAL for none', () => {
    const remote = { type: Arrangement.remote, country: null, city: null };
    const segments = buildSegments([
      ...many(2, { ...remote, locationRegion: Region.EMEA }),
      ...many(1, { ...remote, locationRegion: Region.EMEA, city: 'Rabat' }),
      ...many(2, { ...remote, locationRegion: null }),
    ]);
    expect(segments.map((s) => s.members.length).sort()).toEqual([2, 3]);
    expect(segments.some((s) => s.key.endsWith('|GLOBAL'))).toBe(true);
    expect(segments.some((s) => s.key.includes('null'))).toBe(false);
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
    const builders = many(23);
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

  it('groups LinkedIn builders that search the same place, whatever their region', () => {
    const remote = { type: Arrangement.remote, country: null, city: null };
    const segments = buildSegments([
      builder({
        ...remote,
        locationRegion: Region.EMEA,
        params: { location: 'EMEA' },
      }),
      builder({
        ...remote,
        locationRegion: Region.MENA,
        params: { location: 'EMEA' },
      }),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].members).toHaveLength(2);
  });

  it('groups LinkedIn builders by geoId before location text', () => {
    const remote = { type: Arrangement.remote, country: null, city: null };
    const segments = buildSegments([
      builder({
        ...remote,
        locationRegion: Region.EMEA,
        params: { location: 'EMEA', geoId: '91000007' },
      }),
      builder({
        ...remote,
        locationRegion: Region.MENA,
        params: {
          location: 'Europe, Middle East and Africa',
          geoId: '91000007',
        },
      }),
    ]);
    expect(segments).toHaveLength(1);
  });

  it('keeps the region key for channels other than the LinkedIn job board', () => {
    const b = builder({
      channel: Channel.ASHBY,
      type: Arrangement.remote,
      country: null,
      city: null,
      locationRegion: Region.MENA,
      params: { location: 'EMEA' },
    });
    expect(segmentKey(b)).toBe(`${Channel.ASHBY}|backend|remote|MENA`);
  });

  it('keeps each member cursor when builders are regrouped', () => {
    const remote = { type: Arrangement.remote, country: null, city: null };
    const until = new Date('2026-11-01T12:00:00Z');
    const [merged] = buildSegments([
      builder({
        ...remote,
        locationRegion: Region.EMEA,
        params: { location: 'EMEA' },
        coveredUntil: new Date('2026-11-01T11:00:00Z'),
      }),
      builder({
        ...remote,
        locationRegion: Region.MENA,
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
