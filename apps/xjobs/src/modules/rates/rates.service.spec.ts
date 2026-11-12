import { Logger } from '@nestjs/common';
import { RatesService } from './rates.service';

function repo() {
  return { upsertMany: vi.fn(async () => undefined) };
}
function fetchOf(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body }) as Response);
}
const good = {
  result: 'success',
  rates: { USD: 1, EUR: 0.9, MAD: 9.8, GBP: 0.75 },
};

describe('RatesService.refresh', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refresh upserts parsed rates', async () => {
    const r = repo();
    const service = new RatesService(r as never, fetchOf(good));
    expect(await service.refresh()).toEqual({ updated: 4 });
    expect(r.upsertMany).toHaveBeenCalledWith(
      new Map([
        ['USD', 1],
        ['EUR', 0.9],
        ['MAD', 9.8],
        ['GBP', 0.75],
      ]),
    );
  });

  it('a failed fetch keeps the last rates and does not throw', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const r = repo();
    const failing = vi.fn(async () => {
      throw new Error('network down');
    });
    const service = new RatesService(r as never, failing);
    expect(await service.refresh()).toEqual({ updated: 0 });
    expect(r.upsertMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it.each([
    ['a non-success result', { result: 'error', rates: good.rates }],
    ['a missing rates field', { result: 'success' }],
  ])('keeps the old rows on %s', async (_n, body) => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const r = repo();
    const service = new RatesService(r as never, fetchOf(body));
    expect(await service.refresh()).toEqual({ updated: 0 });
    expect(r.upsertMany).not.toHaveBeenCalled();
  });

  it('keeps the old rows on an HTTP error', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const r = repo();
    const service = new RatesService(r as never, fetchOf(good, false));
    expect(await service.refresh()).toEqual({ updated: 0 });
    expect(r.upsertMany).not.toHaveBeenCalled();
  });

  it('ignores codes outside ISO 4217', async () => {
    const r = repo();
    const service = new RatesService(
      r as never,
      fetchOf({ result: 'success', rates: { EUR: 0.9, ZZZ: 3, BTC: 0.00001 } }),
    );
    expect(await service.refresh()).toEqual({ updated: 1 });
    expect(r.upsertMany).toHaveBeenCalledWith(new Map([['EUR', 0.9]]));
  });

  it('skips rates that are not positive finite numbers', async () => {
    const r = repo();
    const service = new RatesService(
      r as never,
      fetchOf({
        result: 'success',
        rates: {
          EUR: 0.9,
          GBP: 0,
          MAD: -1,
          USD: '1',
          JPY: null,
          CHF: Infinity,
        },
      }),
    );
    expect(await service.refresh()).toEqual({ updated: 1 });
    expect(r.upsertMany).toHaveBeenCalledWith(new Map([['EUR', 0.9]]));
  });
});

describe('RatesService.hasRates', () => {
  it('is false for an empty table and true once a rate is stored', async () => {
    const all = vi.fn(async () => new Map<string, number>());
    const service = new RatesService({ all } as never, fetchOf(good));
    expect(await service.hasRates()).toBe(false);
    all.mockResolvedValueOnce(new Map([['EUR', 0.9]]));
    expect(await service.hasRates()).toBe(true);
  });
});
