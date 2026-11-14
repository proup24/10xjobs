const MOROCCO = 'Africa/Casablanca';

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: MOROCCO,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** Morocco's wall clock at `instant`, as the UTC time showing the same digits. */
function wallClockAsUtc(instant: Date): number {
  const value = Object.fromEntries(
    parts
      .formatToParts(instant)
      .map(({ type, value }) => [type, Number(value)]),
  ) as Record<string, number>;
  return Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour,
    value.minute,
    value.second,
  );
}

/** Milliseconds Morocco is ahead of UTC at `instant`; 0 during Ramadan, 1 hour otherwise. */
function offsetMs(instant: Date): number {
  const whole = Math.floor(instant.getTime() / 1000) * 1000;
  return wallClockAsUtc(new Date(whole)) - whole;
}

/**
 * The instant of 00:00 in Morocco on the local date of `now`. The offset is
 * read from the time zone data, so it follows the Ramadan change; it is read
 * again at the midnight found, in case the change fell between midnight and `now`.
 */
export function moroccoDayStart(now: Date): Date {
  const midnightAsUtc =
    Math.floor(wallClockAsUtc(now) / 86_400_000) * 86_400_000;
  let start = midnightAsUtc - offsetMs(now);
  for (let pass = 0; pass < 2; pass++)
    start = midnightAsUtc - offsetMs(new Date(start));
  return new Date(start);
}

/**
 * What a channel may still spend in a tick: the day's spend so far, and each
 * run's cost added as it ends, so the next run is checked against the total.
 */
export class DailyBudget {
  /** Set once the cap has been logged for this tick. */
  announced = false;
  private spentMicroUsd: number;

  constructor(
    readonly limitUsd: number,
    spentMicroUsd: number,
    readonly dayStart: Date,
  ) {
    this.spentMicroUsd = spentMicroUsd;
  }

  get reached(): boolean {
    return this.spentMicroUsd >= this.limitUsd * 1_000_000;
  }

  get spentUsd(): number {
    return Math.round(this.spentMicroUsd) / 1_000_000;
  }

  add(microUsd: number): void {
    this.spentMicroUsd += microUsd;
  }
}
