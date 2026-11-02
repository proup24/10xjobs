import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';
import {
  listTables,
  type ListTableRow,
} from 'src/database/seeds/processor.seed';
import { inRetriedTransaction } from 'src/modules/ingest/repositories/raw.repository';
import type { ListOptions } from '../schema';
import { LIST_NAMES, type ListName } from '../vocab/lists';
import { slugCode, type VocabSnapshot } from '../vocab/resolve';

export interface Vocabulary {
  /** Approved codes per list, sorted: what the model may answer. */
  options: ListOptions;
  vocab: VocabSnapshot;
  /** Region code to the country codes it contains. */
  regionCountries: Map<string, string[]>;
}

/** The list tables and cities, as the processor reads and grows them. */
export abstract class VocabRepository {
  /** Approved terms only: a proposed term is never offered or matched. */
  abstract snapshot(): Promise<Vocabulary>;
  /**
   * Upserts each unknown term as `proposed` under `slugCode(text)`, counting
   * each sighting. An approved row with that code is never touched.
   */
  abstract propose(p: { list: ListName; text: string }[]): Promise<void>;
  /** Creates missing cities as `proposed`; maps each `"name|CC"` given to its city id. */
  abstract upsertCities(
    c: { name: string; countryCode: string }[],
  ): Promise<Map<string, string>>;
  /** Counts one more sighting of each code (repeats count each time). */
  abstract bumpOccurrences(list: ListName, codes: string[]): Promise<void>;
  /** Proposed terms, most sighted first. */
  abstract listProposed(list: ListName): Promise<ProposedTerm[]>;
  /** Makes a proposed term approved; false (nothing changed) when it is missing or already approved. */
  abstract approve(list: ListName, code: string): Promise<boolean>;
  /**
   * Adds the proposed term's label (lower-case) to the approved target's
   * aliases and deletes the proposed row. Throws when the source is not
   * proposed or the target is not approved; nothing else changes.
   */
  abstract alias(list: ListName, code: string, to: string): Promise<void>;
  /** Deletes a proposed term; false when it is missing or approved (never deleted). */
  abstract reject(list: ListName, code: string): Promise<boolean>;
  /** Proposed cities, most sighted first. */
  abstract listProposedCities(): Promise<ProposedCity[]>;
  abstract approveCity(id: string): Promise<boolean>;
  /**
   * Deletes a proposed city; false when it is missing, approved, or an
   * extraction's `cityIds` still names it.
   */
  abstract rejectCity(id: string): Promise<boolean>;
}

export interface ProposedTerm {
  code: string;
  label: string;
  aliases: string[];
  occurrences: number;
}

export interface ProposedCity {
  id: string;
  name: string;
  countryCode: string;
  occurrences: number;
}

/**
 * Lower-cased, trimmed matching forms of approved rows, mapped to their code.
 * A code beats a label and a label beats an alias, so an alias can never
 * redirect another term's own code.
 */
export function matchingForms(
  rows: readonly ListTableRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  const approved = rows.filter((r) => r.status === 'approved');
  const add = (form: string, code: string) => {
    const k = form.trim().toLowerCase();
    if (k !== '' && !map.has(k)) map.set(k, code);
  };
  for (const r of approved) add(r.code, r.code);
  for (const r of approved) add(r.label, r.code);
  for (const r of approved) for (const a of r.aliases) add(a, r.code);
  return map;
}

/** Repeats of the same key collapse into one entry with a count, in key order. */
function tally<T>(
  items: T[],
  keyOf: (item: T) => string,
): [string, T, number][] {
  const counts = new Map<string, [T, number]>();
  for (const item of items) {
    const k = keyOf(item);
    const seen = counts.get(k);
    counts.set(k, seen ? [seen[0], seen[1] + 1] : [item, 1]);
  }
  // A fixed order makes concurrent writers lock rows in the same order.
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, [item, n]]) => [k, item, n]);
}

/** The key `upsertCities` maps each city to its id under. */
export const cityKey = (c: { name: string; countryCode: string }) =>
  `${c.name}|${c.countryCode}`;

@Injectable()
export class PrismaVocabRepository extends VocabRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async snapshot(): Promise<Vocabulary> {
    const tables = listTables(this.database.db);
    const options = {} as ListOptions;
    const approved = {} as VocabSnapshot['approved'];
    for (const list of LIST_NAMES) {
      const rows = await tables[list].where({ status: 'approved' }).all();
      options[list] = rows.map((r) => r.code).sort();
      approved[list] = matchingForms(rows);
    }
    const regionCountries = new Map<string, string[]>();
    for (const link of await this.database.db.orm.public.RegionCountry.all()) {
      const countries = regionCountries.get(link.regionCode) ?? [];
      countries.push(link.countryCode);
      regionCountries.set(link.regionCode, countries);
    }
    for (const countries of regionCountries.values()) countries.sort();
    return { options, vocab: { approved }, regionCountries };
  }

  async propose(p: { list: ListName; text: string }[]): Promise<void> {
    const terms = tally(
      p
        .map((t) => ({ ...t, code: slugCode(t.text) }))
        .filter((t) => t.code !== ''),
      (t) => `${t.list}\u0000${t.code}`,
    );
    if (terms.length === 0) return;
    await inRetriedTransaction(this.database, async (tx) => {
      const tables = listTables(tx);
      const now = new Date();
      for (const [, { list, code, text }, n] of terms) {
        const table = tables[list];
        const alias = text.trim().toLowerCase();
        const existing = await table.where({ code }).forNoKeyUpdate().first();
        if (!existing) {
          await table.create({
            code,
            label: text.trim(),
            aliases: alias === code ? [] : [alias],
            status: 'proposed',
            occurrences: n,
            firstSeenAt: now,
            approvedAt: null,
            ...(list === 'techTags' ? { family: null, implies: [] } : {}),
          });
        } else if (existing.status === 'proposed') {
          const aliases =
            alias === code || existing.aliases.includes(alias)
              ? existing.aliases
              : [...existing.aliases, alias];
          await table
            .where({ code })
            .updateAll({ occurrences: existing.occurrences + n, aliases });
        }
      }
    });
  }

  async upsertCities(
    c: { name: string; countryCode: string }[],
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    if (c.length === 0) return ids;
    const cities = tally(
      c,
      (city) => `${city.countryCode}|${city.name.toLowerCase()}`,
    );
    const byKey = await inRetriedTransaction(this.database, async (tx) => {
      const found = new Map<string, string>();
      const now = new Date();
      for (const [k, { name, countryCode }, n] of cities) {
        const nameKey = name.toLowerCase();
        const existing = await tx.orm.public.City.where({
          nameKey,
          countryCode,
        })
          .forNoKeyUpdate()
          .first();
        if (existing) {
          await tx.orm.public.City.where({ id: existing.id }).updateAll({
            occurrences: existing.occurrences + n,
          });
          found.set(k, existing.id);
        } else {
          const created = await tx.orm.public.City.create({
            name,
            nameKey,
            countryCode,
            geonamesId: null,
            aliases: [],
            status: 'proposed',
            occurrences: n,
            firstSeenAt: now,
            approvedAt: null,
          });
          found.set(k, created.id);
        }
      }
      return found;
    });
    for (const city of c) {
      const id = byKey.get(`${city.countryCode}|${city.name.toLowerCase()}`);
      if (id) ids.set(cityKey(city), id);
    }
    return ids;
  }

  async bumpOccurrences(list: ListName, codes: string[]): Promise<void> {
    const counted = tally(codes, (code) => code);
    if (counted.length === 0) return;
    await inRetriedTransaction(this.database, async (tx) => {
      const table = listTables(tx)[list];
      for (const [code, , n] of counted) {
        const row = await table.where({ code }).forNoKeyUpdate().first();
        if (row)
          await table
            .where({ code })
            .updateAll({ occurrences: row.occurrences + n });
      }
    });
  }

  async listProposed(list: ListName): Promise<ProposedTerm[]> {
    const rows = await listTables(this.database.db)
      [list].where({ status: 'proposed' })
      .all();
    return rows
      .map(({ code, label, aliases, occurrences }) => ({
        code,
        label,
        aliases,
        occurrences,
      }))
      .sort(
        (a, b) => b.occurrences - a.occurrences || (a.code < b.code ? -1 : 1),
      );
  }

  async approve(list: ListName, code: string): Promise<boolean> {
    return inRetriedTransaction(this.database, async (tx) => {
      const table = listTables(tx)[list];
      const row = await table.where({ code }).forNoKeyUpdate().first();
      if (row?.status !== 'proposed') return false;
      await table
        .where({ code })
        .updateAll({ status: 'approved', approvedAt: new Date() });
      return true;
    });
  }

  async alias(list: ListName, code: string, to: string): Promise<void> {
    await inRetriedTransaction(this.database, async (tx) => {
      const table = listTables(tx)[list];
      const source = await table.where({ code }).forNoKeyUpdate().first();
      if (source?.status !== 'proposed')
        throw new Error(`${list}: ${code} is not a proposed term`);
      const target = await table.where({ code: to }).forNoKeyUpdate().first();
      if (target?.status !== 'approved')
        throw new Error(`${list}: ${to} is not an approved term`);
      const form = source.label.trim().toLowerCase();
      if (form !== to && !target.aliases.includes(form))
        await table
          .where({ code: to })
          .updateAll({ aliases: [...target.aliases, form] });
      await table.where({ code }).deleteAll();
    });
  }

  async reject(list: ListName, code: string): Promise<boolean> {
    return inRetriedTransaction(this.database, async (tx) => {
      const table = listTables(tx)[list];
      const row = await table.where({ code }).forNoKeyUpdate().first();
      if (row?.status !== 'proposed') return false;
      await table.where({ code }).deleteAll();
      return true;
    });
  }

  async listProposedCities(): Promise<ProposedCity[]> {
    const rows = await this.database.db.orm.public.City.where({
      status: 'proposed',
    }).all();
    return rows
      .map(({ id, name, countryCode, occurrences }) => ({
        id,
        name,
        countryCode,
        occurrences,
      }))
      .sort((a, b) => b.occurrences - a.occurrences || (a.id < b.id ? -1 : 1));
  }

  async approveCity(id: string): Promise<boolean> {
    return inRetriedTransaction(this.database, async (tx) => {
      const city = tx.orm.public.City;
      const row = await city.where({ id }).forNoKeyUpdate().first();
      if (row?.status !== 'proposed') return false;
      await city
        .where({ id })
        .updateAll({ status: 'approved', approvedAt: new Date() });
      return true;
    });
  }

  async rejectCity(id: string): Promise<boolean> {
    return inRetriedTransaction(this.database, async (tx) => {
      const city = tx.orm.public.City;
      const row = await city.where({ id }).forNoKeyUpdate().first();
      if (row?.status !== 'proposed') return false;
      // `cityIds` is a uuid array without a foreign key: refuse while it is in use.
      const used = await tx.query(
        tx.raw
          .sql`SELECT e.id FROM job_extractions e WHERE ${id}::uuid = ANY(e."cityIds") LIMIT 1`
          .returnsRow({ id: 'pg/uuid@1' })
          .build(),
      );
      if (used.length > 0) return false;
      await city.where({ id }).deleteAll();
      return true;
    });
  }
}
