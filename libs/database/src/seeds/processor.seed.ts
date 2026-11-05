import {
  ENGINEERING_ROLE_KINDS,
  SEED,
  SEED_REGION_COUNTRIES,
  SEED_TECH_EXTRAS,
  type SeedTerm,
} from './vocab/seed-data';
import type { ListName } from './vocab/lists';
import type {
  ArrangementTermRow,
  ContractTypeRow,
  CountryRow,
  EngagementTermRow,
  JunkFlagRow,
  RegionTermRow,
  RoleKindRow,
  SeniorityTermRow,
  TechTagRow,
} from '../client/models';
import type { DatabaseTransaction, Seed } from './seed.interface';

/** One row of any list table, as the code reading every list sees it. */
export interface ListTableRow {
  code: string;
  label: string;
  aliases: string[];
  status: string;
  occurrences: number;
}

/**
 * The slice of a list table the seed and the vocabulary repository use; every
 * list model has it.
 */
export interface ListTable {
  where(filter: { code: string } | { status: string }): {
    first(): Promise<ListTableRow | null | undefined>;
    all(): PromiseLike<ListTableRow[]>;
    forNoKeyUpdate(): { first(): Promise<ListTableRow | null | undefined> };
    update(data: { aliases: string[] }): Promise<unknown>;
    updateAll(data: {
      occurrences?: number;
      aliases?: string[];
      status?: string;
      approvedAt?: Date;
    }): PromiseLike<unknown[]>;
    deleteAll(): PromiseLike<unknown[]>;
  };
  create(data: Record<string, unknown>): Promise<unknown>;
}

/** Columns every list row has; the seed writes exactly these. */
interface ListRow {
  code: string;
  label: string;
  aliases: readonly string[];
  status: string;
  occurrences: number;
  firstSeenAt: Date;
  approvedAt: Date | null;
}

/**
 * Compile-time guard: renaming or retyping a list column in the contract breaks
 * typecheck here, instead of failing at seed time.
 */
type AssertListRows<_T extends ListRow[]> = true;
export type ListRowsMatchSeed = AssertListRows<
  [
    TechTagRow,
    RegionTermRow,
    CountryRow,
    RoleKindRow,
    SeniorityTermRow,
    ArrangementTermRow,
    ContractTypeRow,
    EngagementTermRow,
    JunkFlagRow,
  ]
>;

/** Each list's table, by list name. */
export function listTables(
  client: Pick<DatabaseTransaction, 'orm'>,
): Record<ListName, ListTable> {
  const orm = client.orm.public;
  return {
    techTags: orm.TechTag,
    regions: orm.RegionTerm,
    countries: orm.Country,
    roleKinds: orm.RoleKind,
    seniorities: orm.SeniorityTerm,
    arrangements: orm.ArrangementTerm,
    contractTypes: orm.ContractType,
    engagements: orm.EngagementTerm,
    junkFlags: orm.JunkFlag,
  };
}

async function upsertTerm(
  table: ListTable,
  term: SeedTerm,
  extra: Record<string, unknown>,
): Promise<void> {
  const existing = await table.where({ code: term.code }).first();
  if (!existing) {
    const now = new Date();
    await table.create({
      code: term.code,
      label: term.label,
      aliases: term.aliases,
      status: 'approved',
      occurrences: 0,
      firstSeenAt: now,
      approvedAt: now,
      ...extra,
    });
    return;
  }
  // An existing row keeps its status, label and extras; only missing aliases are added.
  const missing = term.aliases.filter((a) => !existing.aliases.includes(a));
  if (missing.length > 0) {
    await table
      .where({ code: term.code })
      .update({ aliases: [...existing.aliases, ...missing] });
  }
}

/**
 * @description Seeds every processor list table as `approved`. Idempotent: it never
 * changes an existing row's status and only adds aliases that are missing.
 */
export const processorListsSeed: Seed = {
  name: 'processor-lists',
  async run(tx) {
    const tables = listTables(tx);
    // Countries and regions come first: region_countries references both.
    for (const list of [
      'countries',
      'regions',
      'techTags',
      'roleKinds',
      'seniorities',
      'arrangements',
      'contractTypes',
      'engagements',
      'junkFlags',
    ] as const) {
      for (const term of SEED[list]) {
        const extras =
          list === 'techTags'
            ? (SEED_TECH_EXTRAS[term.code] ?? { family: null, implies: [] })
            : list === 'roleKinds'
              ? { isEngineering: ENGINEERING_ROLE_KINDS.includes(term.code) }
              : {};
        await upsertTerm(tables[list], term, extras);
      }
    }

    for (const [regionCode, countryCode] of SEED_REGION_COUNTRIES) {
      const existing = await tx.orm.public.RegionCountry.where({
        regionCode,
        countryCode,
      }).first();
      if (!existing) {
        await tx.orm.public.RegionCountry.create({ regionCode, countryCode });
      }
    }
  },
};
