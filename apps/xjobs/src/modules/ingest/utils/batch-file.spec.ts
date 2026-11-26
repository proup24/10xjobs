import { Channel } from 'src/common/enums';
import type { BatchFile } from '../types';
import {
  BatchFileError,
  batchStorageKey,
  parseBatchFile,
  serializeBatchFile,
} from './batch-file';

const file: BatchFile = {
  formatVersion: 1,
  batchId: 'b1',
  channel: Channel.ASHBY,
  segmentRunId: 'r1',
  observedAt: '2026-10-31T23:30:00.000Z',
  source: { actor: 'apify/google-search-scraper', apifyRunId: 'run-1' },
  queries: [{ id: 'q1', keyword: 'node', params: { remote: true } }],
  itemsByQuery: { q1: [{ rank: 1, payload: { hit: { url: 'u' } } }] },
  unattributed: [{ rank: null, payload: { hit: { url: 'v' } } }],
};

describe('batch file', () => {
  it('round-trips', () => {
    expect(parseBatchFile(serializeBatchFile(file))).toEqual(file);
  });

  it('rejects an unknown format version', () => {
    const data = Buffer.from(JSON.stringify({ ...file, formatVersion: 2 }));
    expect(() => parseBatchFile(data)).toThrow(BatchFileError);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseBatchFile(Buffer.from('{nope'))).toThrow(BatchFileError);
  });

  it('rejects a file missing its items', () => {
    const { itemsByQuery: _items, ...rest } = file;
    expect(() => parseBatchFile(Buffer.from(JSON.stringify(rest)))).toThrow(
      BatchFileError,
    );
  });

  it('rejects an unknown channel', () => {
    const data = Buffer.from(JSON.stringify({ ...file, channel: 'MONSTER' }));
    expect(() => parseBatchFile(data)).toThrow(BatchFileError);
  });

  it('keys a batch by channel, UTC day and segment run', () => {
    expect(
      batchStorageKey(Channel.ASHBY, new Date('2026-10-31T23:30:00Z'), 'r1'),
    ).toBe('ASHBY/2026-10-31/r1.json');
  });
});
