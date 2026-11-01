import {
  SEED,
  SEED_REGION_COUNTRIES,
  SEED_TECH_EXTRAS,
  type SeedTerm,
} from 'src/modules/processor/vocab/seed-data';
import type { ListName } from 'src/modules/processor/vocab/lists';
import type { DatabaseTransaction, Seed } from './seed.interface';

/** The slice of a list table the seed touches; every list model has it. */
interface ListTable {
  where(filter: { code: string }): {
    first(): Promise<{ aliases: string[] } | null | undefined>;
    update(data: { aliases: string[] }): Promise<unknown>;
  };
  create(data: Record<string, unknown>): Promise<unknown>;
}

function listTables(tx: DatabaseTransaction): Record<ListName, ListTable> {
  const orm = tx.orm.public;
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
  } as unknown as Record<ListName, ListTable>;
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
