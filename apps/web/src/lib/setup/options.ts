/** Notice periods offered on step 4, stored in days. */
export const NOTICE_OPTIONS: readonly { days: number; label: string }[] = [
  { days: 0, label: 'Immediately' },
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '1 month' },
  { days: 60, label: '2 months' },
  { days: 90, label: '3 months' },
  { days: 180, label: '6 months' },
];

/** The offered notice closest to `days`; a tie goes to the shorter one. */
export function nearestNotice(days: number): number {
  let best = NOTICE_OPTIONS[0].days;
  for (const { days: option } of NOTICE_OPTIONS) {
    if (Math.abs(option - days) < Math.abs(best - days)) best = option;
  }
  return best;
}

export const MIN_OFFSET = -720;
export const MAX_OFFSET = 840;

/** The real half- and quarter-hour UTC offsets, in minutes. */
const FRACTIONAL_OFFSETS = [
  -570, -210, 210, 270, 330, 345, 390, 525, 570, 630, 765,
];

/** UTC offsets offered, in minutes, ascending: every whole hour plus the fractional ones. */
export const TIMEZONE_OFFSETS: readonly number[] = [
  ...Array.from(
    { length: (MAX_OFFSET - MIN_OFFSET) / 60 + 1 },
    (_, i) => MIN_OFFSET + i * 60,
  ),
  ...FRACTIONAL_OFFSETS,
].sort((a, b) => a - b);

/** "UTC", "UTC+4", "UTC+5:30", "UTC−1" (Unicode minus). */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
}

/** The offered offset nearest to `minutes`; a tie goes to the lower one. */
export function snapOffset(minutes: number): number {
  return TIMEZONE_OFFSETS.reduce((best, o) =>
    Math.abs(o - minutes) < Math.abs(best - minutes) ? o : best,
  );
}

/** The largest offered offset at or below `minutes` (the lowest when there is none). */
export function snapOffsetDown(minutes: number): number {
  return TIMEZONE_OFFSETS.findLast((o) => o <= minutes) ?? MIN_OFFSET;
}

/** The smallest offered offset at or above `minutes` (the highest when there is none). */
export function snapOffsetUp(minutes: number): number {
  return TIMEZONE_OFFSETS.find((o) => o >= minutes) ?? MAX_OFFSET;
}

/**
 * The time zone answers prefilled from the browser offset
 * (`-new Date().getTimezoneOffset()`): current, and a range of at least ±3 hours.
 * Every value is an offered offset; the range snaps outward, so it never narrows.
 */
export function timezonePrefill(browserOffset: number): {
  current: number;
  min: number;
  max: number;
} {
  const current = snapOffset(browserOffset) + 0; // + 0 turns -0 into 0
  return {
    current,
    min: snapOffsetDown(current - 180),
    max: snapOffsetUp(current + 180),
  };
}
