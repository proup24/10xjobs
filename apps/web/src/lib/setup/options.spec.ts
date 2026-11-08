// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  formatOffset,
  nearestNotice,
  NOTICE_OPTIONS,
  snapOffset,
  snapOffsetDown,
  snapOffsetUp,
  TIMEZONE_OFFSETS,
  timezonePrefill,
} from './options';

describe('notice options', () => {
  it('offers the seven spec options in days', () => {
    expect(NOTICE_OPTIONS).toEqual([
      { days: 0, label: 'Immediately' },
      { days: 7, label: '1 week' },
      { days: 14, label: '2 weeks' },
      { days: 30, label: '1 month' },
      { days: 60, label: '2 months' },
      { days: 90, label: '3 months' },
      { days: 180, label: '6 months' },
    ]);
  });

  it.each([
    [0, 0],
    [7, 7],
    [45, 30],
    [21, 14],
    [500, 180],
    [-3, 0],
    [46, 60],
  ])('nearestNotice(%i) is %i (ties go to the shorter)', (days, expected) => {
    expect(nearestNotice(days)).toBe(expected);
  });
});

describe('time zone offsets', () => {
  it('lists every whole hour from -720 to +840 and the real fractional offsets, sorted', () => {
    const hours = Array.from({ length: 27 }, (_, i) => -720 + i * 60);
    const fractional = [
      -570, -210, 210, 270, 330, 345, 390, 525, 570, 630, 765,
    ];
    expect(TIMEZONE_OFFSETS).toEqual(
      [...hours, ...fractional].sort((a, b) => a - b),
    );
  });

  it.each([
    [330, 'UTC+5:30'],
    [345, 'UTC+5:45'],
    [-60, 'UTC−1'],
    [-570, 'UTC−9:30'],
    [0, 'UTC'],
    [-0, 'UTC'],
    [840, 'UTC+14'],
  ])('formatOffset(%i) is %s', (minutes, label) => {
    expect(formatOffset(minutes)).toBe(label);
  });

  it('prefills current ± 3 hours', () => {
    expect(timezonePrefill(60)).toEqual({ current: 60, min: -120, max: 240 });
  });

  it('clamps the range to the offsets that exist', () => {
    expect(timezonePrefill(780)).toEqual({ current: 780, min: 600, max: 840 });
    expect(timezonePrefill(-600)).toEqual({
      current: -600,
      min: -720,
      max: -420,
    });
  });

  it.each([
    [330, { current: 330, min: 120, max: 525 }],
    [345, { current: 345, min: 120, max: 525 }],
    [-570, { current: -570, min: -720, max: -360 }],
  ])(
    'widens the range of %i outward to offered offsets',
    (browser, expected) => {
      const r = timezonePrefill(browser);
      expect(r).toEqual(expected);
      for (const v of Object.values(r)) {
        expect(TIMEZONE_OFFSETS).toContain(v);
      }
    },
  );

  it('snaps a browser offset that is not offered to the nearest one', () => {
    expect(timezonePrefill(100).current).toBe(120);
    expect(timezonePrefill(10).current).toBe(0);
  });

  it.each([
    [100, 120, 60, 120],
    [-200, -210, -210, -180],
    [-900, -720, -720, -720],
    [900, 840, 840, 840],
    [330, 330, 330, 330],
  ])('snaps %i: nearest %i, down %i, up %i', (m, nearest, down, up) => {
    expect(snapOffset(m)).toBe(nearest);
    expect(snapOffsetDown(m)).toBe(down);
    expect(snapOffsetUp(m)).toBe(up);
  });

  it('reads a browser -0 as UTC', () => {
    expect(Object.is(timezonePrefill(-0).current, 0)).toBe(true);
  });
});
