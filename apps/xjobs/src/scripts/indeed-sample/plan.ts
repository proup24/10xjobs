import {
  ACTORS,
  type ActorName,
  type ActorSpec,
  type PlaceId,
  type SampleSearch,
} from './actors';

export const TOTAL_CAP_USD = 1.5;

export interface Keywords {
  plain: string;
  real: Record<PlaceId, string>;
}

export interface PlannedRun {
  actor: ActorName;
  search: SampleSearch;
  input: Record<string, unknown>;
  reservedUsd: number;
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

/** Event prices from an Apify act JSON: the last pricing entry, flat price first, else the FREE tier. */
export function parseEventPrices(actJson: unknown): EventPrices {
  const data = record(record(actJson)?.data);
  const infos = data?.pricingInfos;
  if (!Array.isArray(infos) || infos.length === 0) {
    throw new Error('Act JSON has no data.pricingInfos');
  }
  const events = record(
    record(record(infos[infos.length - 1])?.pricingPerEvent)?.actorChargeEvents,
  );
  if (!events) {
    throw new Error(
      'Last pricingInfos entry is not pay-per-event (no pricingPerEvent.actorChargeEvents)',
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

function priceOf(spec: ActorSpec, prices: EventPrices, event: string): number {
  const usd = prices[event];
  if (typeof usd !== 'number') {
    throw new Error(`Actor ${spec.name} has no price for event ${event}`);
  }
  return usd;
}

/** Worst-case cost of one run: every row at every row event, plus the start event, rounded up to the cent. */
export function reserveUsd(spec: ActorSpec, prices: EventPrices): number {
  const perRow = spec.rowEvents.reduce(
    (sum, event) => sum + priceOf(spec, prices, event),
    0,
  );
  const total = spec.rows * perRow + priceOf(spec, prices, spec.startEvent);
  return Math.ceil(total * 100 - 1e-9) / 100;
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
    const reservedUsd = reserveUsd(spec, prices[actor]);
    for (const search of searches) {
      runs.push({ actor, search, input: spec.buildInput(search), reservedUsd });
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
