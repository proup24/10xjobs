import { describe, expect, it, vi } from 'vitest';
import { finishSample, runItems, startOptions } from './paid';
import type { PlannedRun } from './plan';

const RUN: PlannedRun = {
  actor: 'valig',
  search: {
    id: 'us-remote-plain',
    place: 'us-remote',
    keywordKind: 'plain',
    keyword: 'k',
    remoteBy: 'location',
    seniorOnly: false,
  },
  input: {},
  reservedUsd: 0.02,
  memoryMbytes: 128,
  timeoutSecs: 900,
};

describe('startOptions', () => {
  it('caps the charge at the reservation and pins memory and timeout', () => {
    expect(startOptions(RUN)).toEqual({
      maxTotalChargeUsd: 0.02,
      memory: 128,
      timeout: 900,
    });
  });
});

describe('runItems', () => {
  it('lists the items of a run that did not succeed, tagged by the file status', async () => {
    await expect(
      runItems('TIMED-OUT', async () => [{ a: 1 }]),
    ).resolves.toEqual({ items: [{ a: 1 }] });
  });

  it('keeps going when listing a stopped run fails', async () => {
    await expect(
      runItems('FAILED', async () => {
        throw new Error('dataset gone');
      }),
    ).resolves.toEqual({ items: [], itemsError: 'dataset gone' });
  });

  it('throws when listing a succeeded run fails', async () => {
    await expect(
      runItems('SUCCEEDED', async () => {
        throw new Error('dataset gone');
      }),
    ).rejects.toThrow('dataset gone');
  });
});

describe('finishSample', () => {
  it('builds the report and is fine when nothing went wrong', async () => {
    const report = vi.fn(async () => undefined);
    const log = vi.fn();
    await expect(
      finishSample({ failure: null, stopped: false, report, log }),
    ).resolves.toEqual({ exitCode: 0 });
    expect(report).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
  });

  it('exits non-zero after the report when a run stopped without a throw', async () => {
    const report = vi.fn(async () => undefined);
    await expect(
      finishSample({ failure: null, stopped: true, report, log: vi.fn() }),
    ).resolves.toEqual({ exitCode: 1 });
    expect(report).toHaveBeenCalledOnce();
  });

  it('logs the paid failure before the report and rethrows it', async () => {
    const order: string[] = [];
    const failure = new Error('apify down');
    await expect(
      finishSample({
        failure,
        stopped: false,
        report: async () => {
          order.push('report');
        },
        log: (line) => order.push(line),
      }),
    ).rejects.toBe(failure);
    expect(order[0]).toMatch(/apify down/);
    expect(order[0]).toContain(failure.stack as string);
    expect(order[1]).toBe('report');
  });

  it('keeps the paid failure when the report also throws', async () => {
    const lines: string[] = [];
    const failure = new Error('apify down');
    await expect(
      finishSample({
        failure,
        stopped: false,
        report: async () => {
          throw new Error('no plan.json');
        },
        log: (line) => lines.push(line),
      }),
    ).rejects.toBe(failure);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/no plan\.json/);
  });

  it('throws the report error when only the report fails', async () => {
    await expect(
      finishSample({
        failure: null,
        stopped: false,
        report: async () => {
          throw new Error('no plan.json');
        },
        log: vi.fn(),
      }),
    ).rejects.toThrow('no plan.json');
  });
});
