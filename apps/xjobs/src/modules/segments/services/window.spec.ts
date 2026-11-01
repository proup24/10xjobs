import type { QuerySearchBuilderRow } from 'src/database';
import { segmentWindow } from './window';

const until = new Date('2026-10-31T12:00:00Z');
const window = { initialHours: 24, overlapMinutes: 15, maximumHours: 24 };
const at = (iso: string | null) =>
  ({
    coveredUntil: iso === null ? null : new Date(iso),
  }) as QuerySearchBuilderRow;
const hoursBefore = (h: number) => new Date(until.getTime() - h * 3_600_000);

describe('segmentWindow', () => {
  it('looks back the initial hours when no member was collected', () => {
    expect(segmentWindow([at(null), at(null)], until, window)).toEqual({
      since: hoursBefore(24),
      until,
      clipped: false,
    });
  });

  it('starts at the oldest cursor minus the overlap', () => {
    expect(
      segmentWindow(
        [at('2026-10-31T11:00:00Z'), at('2026-10-31T10:00:00Z')],
        until,
        window,
      ),
    ).toEqual({
      since: new Date('2026-10-31T09:45:00Z'),
      until,
      clipped: false,
    });
  });

  it('treats an uncollected member as the oldest', () => {
    expect(
      segmentWindow([at('2026-10-31T11:00:00Z'), at(null)], until, window)
        .since,
    ).toEqual(hoursBefore(24));
  });

  it('clips a window longer than the maximum', () => {
    expect(segmentWindow([at('2026-10-28T12:00:00Z')], until, window)).toEqual({
      since: hoursBefore(24),
      until,
      clipped: true,
    });
  });

  it('stays valid when a cursor is in the future', () => {
    const { since } = segmentWindow(
      [at('2026-10-31T13:00:00Z')],
      until,
      window,
    );
    expect(since.getTime()).toBeLessThan(until.getTime());
  });

  it('searches at least the minimum span when one is set', () => {
    const daily = {
      ...window,
      overlapMinutes: 0,
      maximumHours: 168,
      minimumHours: 72,
    };
    expect(segmentWindow([at('2026-10-31T11:00:00Z')], until, daily)).toEqual({
      since: hoursBefore(72),
      until,
      clipped: false,
    });
    expect(
      segmentWindow([at('2026-10-26T12:00:00Z')], until, daily).since,
    ).toEqual(hoursBefore(120));
  });
});
