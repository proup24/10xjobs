import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from 'src/config';

const sdk = vi.hoisted(() => {
  const actor = {
    call: vi.fn(),
    start: vi.fn(),
    get: vi.fn(),
    runs: vi.fn(),
  };
  const run = { get: vi.fn(), abort: vi.fn(), waitForFinish: vi.fn() };
  const runs = { list: vi.fn() };
  const dataset = { listItems: vi.fn() };
  const keyValueStore = { getRecord: vi.fn() };
  const ApifyClient = vi.fn(function (this: object, options: unknown) {
    Object.assign(this, {
      options,
      actor: vi.fn(() => actor),
      run: vi.fn(() => run),
      dataset: vi.fn(() => dataset),
      keyValueStore: vi.fn(() => keyValueStore),
    });
  });
  class ApifyApiError extends Error {
    constructor(
      readonly statusCode: number,
      readonly httpMethod = 'get',
    ) {
      super(`HTTP ${statusCode}`);
    }
  }
  actor.runs.mockReturnValue(runs);
  return {
    ApifyClient,
    ApifyApiError,
    actor,
    run,
    runs,
    dataset,
    keyValueStore,
  };
});

vi.mock('apify-client', () => ({
  ApifyClient: sdk.ApifyClient,
  ApifyApiError: sdk.ApifyApiError,
}));

import { SearchNotStartedError } from '../../utils/search-not-started';
import { ApifyActorProvider, ApifyRunError } from './apify.provider';

const configWith = (token?: string) =>
  ({
    get: (key: string) => (key === 'APIFY_TOKEN' ? token : undefined),
  }) as unknown as ConfigService<EnvironmentVariables, true>;

/** A dataset listing that is both awaitable and async-iterable, like the SDK's. */
function listing(items: unknown[]) {
  return Object.assign(
    Promise.resolve({
      items,
      total: items.length,
      offset: 0,
      count: items.length,
    }),
    {
      async *[Symbol.asyncIterator]() {
        yield* items;
      },
    },
  );
}

const run = (status: string, extra = {}) => ({
  id: 'run-1',
  status,
  defaultDatasetId: 'dataset-1',
  ...extra,
});

describe('ApifyActorProvider', () => {
  let provider: ApifyActorProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    sdk.actor.runs.mockReturnValue(sdk.runs);
    provider = new ApifyActorProvider(configWith('secret'));
  });

  it('builds the SDK client with the token from the config service, once', async () => {
    sdk.actor.get.mockResolvedValue({ id: 'actor' });
    await provider.findActor('a/b');
    await provider.findActor('a/b');
    expect(sdk.ApifyClient).toHaveBeenCalledTimes(1);
    expect(sdk.ApifyClient).toHaveBeenCalledWith({ token: 'secret' });
  });

  it('refuses to build a client without a configured token', async () => {
    await expect(
      new ApifyActorProvider(configWith()).findActor('a/b'),
    ).rejects.toThrow('APIFY_TOKEN is required for job collection');
    expect(sdk.ApifyClient).not.toHaveBeenCalled();
  });

  it('runs an actor with a spend cap and returns every dataset item', async () => {
    sdk.actor.call.mockResolvedValue(run('SUCCEEDED'));
    sdk.dataset.listItems.mockReturnValue(listing([{ id: 1 }, { id: 2 }]));
    const items = await provider.run(
      'apify/google-search-scraper',
      { queries: 'q' },
      { maxChargeUsd: 0.5 },
    );
    expect(items).toEqual({
      items: [{ id: 1 }, { id: 2 }],
      costUsd: null,
      runId: 'run-1',
      keyValueStoreId: null,
    });
    expect(sdk.actor.call).toHaveBeenCalledWith(
      { queries: 'q' },
      expect.objectContaining({ maxTotalChargeUsd: 0.5, waitSecs: 300 }),
    );
  });

  it('aborts a run that outlives the wait and spends nothing more', async () => {
    sdk.actor.call.mockResolvedValue(run('RUNNING'));
    sdk.run.abort.mockResolvedValue(run('ABORTING'));
    await expect(
      provider.run('a/b', {}, { maxChargeUsd: 1, waitSecs: 10 }),
    ).rejects.toThrow('did not finish in time and was aborted');
    expect(sdk.run.abort).toHaveBeenCalledOnce();
    expect(sdk.dataset.listItems).not.toHaveBeenCalled();
  });

  it('fails a run that did not succeed', async () => {
    sdk.actor.call.mockResolvedValue(
      run('FAILED', { statusMessage: 'Out of memory' }),
    );
    await expect(provider.run('a/b', {}, { maxChargeUsd: 1 })).rejects.toThrow(
      'run run-1 ended FAILED: Out of memory',
    );
  });

  it('throws ApifyRunError with the run id when a run fails', async () => {
    sdk.actor.call.mockResolvedValue(
      run('FAILED', { statusMessage: 'Out of memory' }),
    );
    const error = await provider
      .run('a/b', {}, { maxChargeUsd: 1 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApifyRunError);
    expect(error).toMatchObject({ runId: 'run-1' });
  });

  it('throws ApifyRunError with the run id when a run is aborted for time', async () => {
    sdk.actor.call.mockResolvedValue(run('RUNNING'));
    sdk.run.abort.mockResolvedValue(run('ABORTING'));
    const error = await provider
      .run('a/b', {}, { maxChargeUsd: 1, waitSecs: 10 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApifyRunError);
    expect(error).toMatchObject({ runId: 'run-1' });
  });

  it('reports a start Apify refused as a search that never started', async () => {
    // Apify answers a 4xx to the start POST (here: actor permissions not approved).
    sdk.actor.call.mockRejectedValue(new sdk.ApifyApiError(403, 'post'));
    await expect(
      provider.run('a/b', {}, { maxChargeUsd: 1 }),
    ).rejects.toBeInstanceOf(SearchNotStartedError);
  });

  it('keeps failures that may follow a started run as ordinary errors', async () => {
    // A server error on the start may still have created the run.
    sdk.actor.call.mockRejectedValueOnce(new sdk.ApifyApiError(500, 'post'));
    await expect(
      provider.run('a/b', {}, { maxChargeUsd: 1 }),
    ).rejects.not.toBeInstanceOf(SearchNotStartedError);
    // Any failure while waiting comes after the run was created.
    sdk.actor.call.mockRejectedValueOnce(new sdk.ApifyApiError(404, 'get'));
    await expect(
      provider.run('a/b', {}, { maxChargeUsd: 1 }),
    ).rejects.not.toBeInstanceOf(SearchNotStartedError);
  });

  it('starts, finds, waits for and lists runs', async () => {
    sdk.actor.start.mockResolvedValue(run('READY'));
    sdk.run.get
      .mockResolvedValueOnce(run('RUNNING'))
      .mockResolvedValueOnce(undefined);
    sdk.run.waitForFinish.mockResolvedValue(run('SUCCEEDED'));
    sdk.runs.list.mockResolvedValue({ items: [run('SUCCEEDED')], total: 1 });

    expect(
      (await provider.start('a/b', { q: 1 }, { maxChargeUsd: 2 })).status,
    ).toBe('READY');
    expect(sdk.actor.start).toHaveBeenCalledWith(
      { q: 1 },
      expect.objectContaining({ maxTotalChargeUsd: 2 }),
    );
    expect((await provider.findRun('run-1'))?.status).toBe('RUNNING');
    expect(await provider.findRun('gone')).toBeNull();
    expect((await provider.waitForRun('run-1', 30)).status).toBe('SUCCEEDED');
    expect(sdk.run.waitForFinish).toHaveBeenCalledWith({ waitSecs: 30 });
    expect(
      (await provider.listRuns('a/b', { status: 'SUCCEEDED', limit: 5 })).total,
    ).toBe(1);
    expect(sdk.runs.list).toHaveBeenCalledWith({
      desc: true,
      status: 'SUCCEEDED',
      limit: 5,
    });
  });

  it('pages dataset items and treats aborting a missing run as done', async () => {
    sdk.dataset.listItems.mockReturnValue(listing([{ id: 1 }]));
    expect(
      (await provider.listItems('dataset-1', { offset: 10, limit: 1 })).items,
    ).toEqual([{ id: 1 }]);
    expect(sdk.dataset.listItems).toHaveBeenCalledWith({
      offset: 10,
      limit: 1,
    });

    sdk.run.abort.mockRejectedValue(new sdk.ApifyApiError(404));
    expect(await provider.abortRun('gone')).toBeNull();
    sdk.run.abort.mockRejectedValue(new sdk.ApifyApiError(500));
    await expect(provider.abortRun('run-1')).rejects.toThrow('HTTP 500');
  });

  it("returns the run's key-value store id", async () => {
    sdk.actor.call.mockResolvedValue(
      run('SUCCEEDED', { defaultKeyValueStoreId: 'kv-1' }),
    );
    sdk.dataset.listItems.mockReturnValue(listing([]));
    const result = await provider.run('a/b', {}, { maxChargeUsd: 1 });
    expect(result.keyValueStoreId).toBe('kv-1');
  });
});
