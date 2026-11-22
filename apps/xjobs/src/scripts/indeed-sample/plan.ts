import {
  ACTORS,
  type ActorName,
  type ActorSpec,
  type PlaceId,
  type SampleSearch,
} from './actors';

export const TOTAL_CAP_USD = 1.5;
/** Each run's Apify timeout, passed on start so no actor default (valig's is 300 s) can cut a run short. */
export const RUN_TIMEOUT_SECS = 900;

export interface Keywords {
  plain: string;
  real: Record<PlaceId, string>;
}

export interface PlannedRun {
  actor: ActorName;
  search: SampleSearch;
  input: Record<string, unknown>;
  reservedUsd: number;
  /** Unrounded cost of a run that returns every row: what a full run should charge. */
  worstCaseUsd: number;
  memoryMbytes: number;
  timeoutSecs: number;
}

/** Event name to USD, FREE tier. */
export type EventPrices = Record<string, number>;

const ACTOR_ORDER: ActorName[] = ['valig', 'kaix', 'memo23', 'curious_coder'];
const PLACES: PlaceId[] = ['us-remote', 'uk-remote', 'ma-onsite'];

/** The six core searches. Remote places use the actor's remote filter by default; buildPlan swaps in `location` where there is none. */
export function sampleSearches(k: Keywords): SampleSearch[] {
  return PLACES.flatMap((place) =>
    (['plain', 'real'] as const).map(
      (keywordKind): SampleSearch => ({
        id: `${place}-${keywordKind}`,
        place,
        keywordKind,
        keyword: keywordKind === 'plain' ? k.plain : k.real[place],
        remoteBy: place === 'ma-onsite' ? 'none' : 'filter',
        seniorOnly: false,
      }),
    ),
  );
}

const CORE_IDS = new Set(
  sampleSearches({
    plain: '',
    real: { 'us-remote': '', 'uk-remote': '', 'ma-onsite': '' },
  }).map((s) => s.id),
);

/** True for the six core searches, false for probes. */
export function isCoreSearch(search: SampleSearch): boolean {
  return CORE_IDS.has(search.id);
}

function probes(actor: ActorName, k: Keywords): SampleSearch[] {
  const locRemote: SampleSearch = {
    id: 'us-locremote-plain',
    place: 'us-remote',
    keywordKind: 'plain',
    keyword: k.plain,
    remoteBy: 'location',
    seniorOnly: false,
  };
  const senior: SampleSearch = {
    id: 'us-remote-plain-senior',
    place: 'us-remote',
    keywordKind: 'plain',
    keyword: k.plain,
    remoteBy: 'filter',
    seniorOnly: true,
  };
  if (actor === 'kaix') return [locRemote];
  if (actor === 'memo23') return [locRemote, senior];
  return [];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One pricing entry's events, flat price first, else the FREE tier. */
function entryPrices(info: unknown, label: string): EventPrices {
  const events = record(
    record(record(info)?.pricingPerEvent)?.actorChargeEvents,
  );
  if (!events) {
    throw new Error(
      `${label} pricingInfos entry is not pay-per-event (no pricingPerEvent.actorChargeEvents)`,
    );
  }
  const prices: EventPrices = {};
  for (const [name, raw] of Object.entries(events)) {
    const event = record(raw);
    const flat = event?.eventPriceUsd;
    const free = record(
      record(event?.eventTieredPricingUsd)?.FREE,
    )?.tieredEventPriceUsd;
    const usd = typeof flat === 'number' ? flat : free;
    if (typeof usd !== 'number' || !Number.isFinite(usd)) {
      throw new Error(`Event ${name} has no eventPriceUsd or FREE tier price`);
    }
    prices[name] = usd;
  }
  return prices;
}

/** An entry's start time in ms; a missing or unreadable one counts as always in force. */
function startedAtMs(info: unknown): number {
  const raw = record(info)?.startedAt;
  const ms = typeof raw === 'string' ? Date.parse(raw) : NaN;
  return Number.isNaN(ms) ? -Infinity : ms;
}

/**
 * Event prices from an Apify act JSON: per event, the highest price across the
 * entry in force at `now` (the latest `startedAt` not after it; on a tie, the
 * later in the list) and every entry that starts after `now`, so a scheduled
 * increase is reserved and a superseded past price is not.
 */
export function parseEventPrices(
  actJson: unknown,
  now: Date = new Date(),
): EventPrices {
  const data = record(record(actJson)?.data);
  const infos = data?.pricingInfos;
  if (!Array.isArray(infos) || infos.length === 0) {
    throw new Error('Act JSON has no data.pricingInfos');
  }
  const at = now.getTime();
  let inForce: unknown = undefined;
  let inForceMs = -Infinity;
  const future: unknown[] = [];
  for (const info of infos) {
    const ms = startedAtMs(info);
    if (ms > at) future.push(info);
    else if (inForce === undefined || ms >= inForceMs) {
      inForce = info;
      inForceMs = ms;
    }
  }
  const prices: EventPrices = {};
  const entries = [
    ...(inForce === undefined ? [] : [{ info: inForce, label: 'In-force' }]),
    ...future.map((info) => ({ info, label: 'Future' })),
  ];
  for (const { info, label } of entries) {
    for (const [name, usd] of Object.entries(entryPrices(info, label))) {
      prices[name] = Math.max(prices[name] ?? usd, usd);
    }
  }
  return prices;
}

function priceOf(spec: ActorSpec, prices: EventPrices, event: string): number {
  const usd = prices[event];
  if (typeof usd !== 'number') {
    throw new Error(`Actor ${spec.name} has no price for event ${event}`);
  }
  return usd;
}

/** Start events Apify charges for a run: one per started GB of memory, at least one. */
export function startEvents(memoryMbytes: number): number {
  return Math.max(1, Math.ceil(memoryMbytes / 1024));
}

/** Unrounded worst-case cost of one run: every row at every row event, plus its start events. */
export function worstCaseUsd(spec: ActorSpec, prices: EventPrices): number {
  const perRow = spec.rowEvents.reduce(
    (sum, event) => sum + priceOf(spec, prices, event),
    0,
  );
  return (
    spec.rows * perRow +
    startEvents(spec.memoryMbytes) * priceOf(spec, prices, spec.startEvent)
  );
}

/** Worst-case cost of one run, rounded up to the cent. */
export function reserveUsd(spec: ActorSpec, prices: EventPrices): number {
  return Math.ceil(worstCaseUsd(spec, prices) * 100 - 1e-9) / 100;
}

/** Throws naming the actor and event for a live event the spec neither reserves nor lists as kept off. */
export function checkEvents(spec: ActorSpec, prices: EventPrices): void {
  const known = new Set([
    ...spec.rowEvents,
    spec.startEvent,
    ...Object.keys(spec.knownOffEvents),
  ]);
  for (const event of Object.keys(prices)) {
    if (!known.has(event)) {
      throw new Error(
        `Actor ${spec.name} charges event ${event}, which the plan does not reserve: add it to rowEvents or knownOffEvents`,
      );
    }
  }
}

export function buildPlan(
  k: Keywords,
  prices: Record<ActorName, EventPrices>,
): {
  runs: PlannedRun[];
  reservedUsd: number;
  capUsd: number;
  fits: boolean;
} {
  const core = sampleSearches(k);
  const runs: PlannedRun[] = [];
  for (const actor of ACTOR_ORDER) {
    const spec = ACTORS[actor];
    const searches = [
      ...core.map((s) =>
        !spec.hasRemoteFilter && s.remoteBy === 'filter'
          ? { ...s, remoteBy: 'location' as const }
          : s,
      ),
      ...probes(actor, k),
    ];
    checkEvents(spec, prices[actor]);
    const reservedUsd = reserveUsd(spec, prices[actor]);
    const worstCase = worstCaseUsd(spec, prices[actor]);
    for (const search of searches) {
      runs.push({
        actor,
        search,
        input: spec.buildInput(search),
        reservedUsd,
        worstCaseUsd: worstCase,
        memoryMbytes: spec.memoryMbytes,
        timeoutSecs: RUN_TIMEOUT_SECS,
      });
    }
  }
  const reservedUsd =
    Math.round(runs.reduce((sum, r) => sum + r.reservedUsd, 0) * 100) / 100;
  return {
    runs,
    reservedUsd,
    capUsd: TOTAL_CAP_USD,
    fits: reservedUsd <= TOTAL_CAP_USD,
  };
}
