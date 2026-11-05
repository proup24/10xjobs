import {
  SEED,
  SEED_REGION_COUNTRIES,
} from 'src/modules/processor/vocab/seed-data';
import { processorListsSeed } from './processor.seed';
import type { DatabaseTransaction } from './seed.interface';
import type { SeedEnvironmentVariables } from 'src/config';

/** The processor seed reads no environment. */
const env = {} as SeedEnvironmentVariables;

type Row = Record<string, unknown> & { aliases: string[] };

/** In-memory stand-in for one ORM model: just the calls the seed makes. */
class FakeTable {
  rows: Row[] = [];
  writes = 0;
  constructor(private readonly keys: string[]) {}
  private match(filter: Record<string, unknown>) {
    return this.rows.find((r) =>
      Object.keys(filter).every((k) => r[k] === filter[k]),
    );
  }
  where(filter: Record<string, unknown>) {
    return {
      first: async () => this.match(filter),
      update: async (data: Partial<Row>) => {
        this.writes++;
        Object.assign(this.match(filter) as Row, data);
      },
    };
  }
  async create(data: Row) {
    this.writes++;
    if (this.match(Object.fromEntries(this.keys.map((k) => [k, data[k]])))) {
      throw new Error('duplicate key');
    }
    this.rows.push({ ...data });
  }
}

function makeTx() {
  const names = [
    'TechTag',
    'RegionTerm',
    'Country',
    'RoleKind',
    'SeniorityTerm',
    'ArrangementTerm',
    'ContractType',
    'EngagementTerm',
    'JunkFlag',
  ];
  const pub: Record<string, FakeTable> = Object.fromEntries(
    names.map((n) => [n, new FakeTable(['code'])]),
  );
  pub['RegionCountry'] = new FakeTable(['regionCode', 'countryCode']);
  const tx = { orm: { public: pub } } as unknown as DatabaseTransaction;
  return { tx, pub };
}

const totalWrites = (pub: Record<string, FakeTable>) =>
  Object.values(pub).reduce((n, t) => n + t.writes, 0);

describe('processorListsSeed', () => {
  it('seeds every term as approved', async () => {
    const { tx, pub } = makeTx();
    await processorListsSeed.run(tx, env);
    expect(pub['Country'].rows).toHaveLength(SEED.countries.length);
    expect(pub['TechTag'].rows.every((r) => r['status'] === 'approved')).toBe(
      true,
    );
    expect(pub['RegionCountry'].rows).toHaveLength(
      SEED_REGION_COUNTRIES.length,
    );
  });

  it('writes nothing on a second run and does not duplicate region_countries', async () => {
    const { tx, pub } = makeTx();
    await processorListsSeed.run(tx, env);
    const rowCounts = Object.values(pub).map((t) => t.rows.length);
    for (const t of Object.values(pub)) t.writes = 0;
    await processorListsSeed.run(tx, env);
    expect(totalWrites(pub)).toBe(0);
    expect(Object.values(pub).map((t) => t.rows.length)).toEqual(rowCounts);
  });

  it('keeps a proposed row proposed and only adds its missing aliases', async () => {
    const { tx, pub } = makeTx();
    const typescript = SEED.techTags.find((t) => t.code === 'typescript');
    expect(typescript?.aliases.length).toBeGreaterThan(0);
    pub['TechTag'].rows.push({
      code: 'typescript',
      label: 'Custom label',
      aliases: ['my-alias', typescript?.aliases[0] as string],
      status: 'proposed',
      occurrences: 7,
    });
    await processorListsSeed.run(tx, env);
    const row = pub['TechTag'].rows.find(
      (r) => r['code'] === 'typescript',
    ) as Row;
    expect(row['status']).toBe('proposed');
    expect(row['label']).toBe('Custom label');
    expect(row['occurrences']).toBe(7);
    expect([...row.aliases].sort()).toEqual(
      ['my-alias', ...(typescript?.aliases ?? [])].sort(),
    );
  });
});
