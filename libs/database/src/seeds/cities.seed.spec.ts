import type { SeedEnvironmentVariables } from '../env';
import { makeCitiesSeed } from './cities.seed';
import type { DatabaseTransaction } from './seed.interface';
import type { SeedCity } from './vocab/seed-cities';

const env = {} as SeedEnvironmentVariables;

type Row = Record<string, unknown> & { aliases: string[] };

/** In-memory stand-in for the City model: just the calls the seed makes. */
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

const berlin: SeedCity[] = [
  {
    name: 'Berlin',
    countryCode: 'DE',
    aliases: ['berlín'],
    geonamesId: 2950159,
  },
];

function makeTx() {
  const City = new FakeTable(['nameKey', 'countryCode']);
  const tx = { orm: { public: { City } } } as unknown as DatabaseTransaction;
  return { tx, City };
}

describe('citiesSeed', () => {
  it('creates a missing city as approved', async () => {
    const { tx, City } = makeTx();
    await makeCitiesSeed(berlin).run(tx, env);
    expect(City.rows).toHaveLength(1);
    expect(City.rows[0]).toMatchObject({
      name: 'Berlin',
      nameKey: 'berlin',
      countryCode: 'DE',
      status: 'approved',
      occurrences: 0,
      geonamesId: 2950159,
      aliases: ['berlín'],
    });
    expect(City.rows[0]['approvedAt']).toBeInstanceOf(Date);
    expect(City.rows[0]['firstSeenAt']).toBeInstanceOf(Date);
  });

  it('writes nothing on a second run', async () => {
    const { tx, City } = makeTx();
    const seed = makeCitiesSeed(berlin);
    await seed.run(tx, env);
    City.writes = 0;
    await seed.run(tx, env);
    expect(City.writes).toBe(0);
    expect(City.rows).toHaveLength(1);
  });

  it('promotes a proposed city matched by key, case-insensitively', async () => {
    const { tx, City } = makeTx();
    City.rows.push({
      name: 'berlin',
      nameKey: 'berlin',
      countryCode: 'DE',
      status: 'proposed',
      occurrences: 5,
      approvedAt: null,
      geonamesId: null,
      aliases: ['bln'],
    });
    await makeCitiesSeed(berlin).run(tx, env);
    expect(City.rows).toHaveLength(1);
    const row = City.rows[0];
    expect(row['status']).toBe('approved');
    expect(row['approvedAt']).toBeInstanceOf(Date);
    expect(row['occurrences']).toBe(5);
    expect(row['name']).toBe('berlin');
    expect(row['geonamesId']).toBe(2950159);
    expect([...row.aliases].sort()).toEqual(['berlín', 'bln']);
  });

  it("leaves an approved city's approvedAt and occurrences alone", async () => {
    const { tx, City } = makeTx();
    const approvedAt = new Date('2026-01-01');
    City.rows.push({
      name: 'Berlin',
      nameKey: 'berlin',
      countryCode: 'DE',
      status: 'approved',
      occurrences: 9,
      approvedAt,
      geonamesId: 2950159,
      aliases: ['berlín'],
    });
    await makeCitiesSeed(berlin).run(tx, env);
    expect(City.rows[0]['approvedAt']).toBe(approvedAt);
    expect(City.rows[0]['occurrences']).toBe(9);
    expect(City.writes).toBe(0);
  });

  it('never touches cities not in the list', async () => {
    const { tx, City } = makeTx();
    const paris = {
      name: 'Paris',
      nameKey: 'paris',
      countryCode: 'FR',
      status: 'proposed',
      occurrences: 2,
      approvedAt: null,
      geonamesId: null,
      aliases: [],
    };
    City.rows.push({ ...paris });
    await makeCitiesSeed(berlin).run(tx, env);
    expect(City.rows.find((r) => r['nameKey'] === 'paris')).toEqual(paris);
  });
});
