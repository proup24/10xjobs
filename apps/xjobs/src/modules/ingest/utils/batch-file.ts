import { Channel } from 'src/common/enums';
import type { BatchFile, RawCollectedItem } from '../types';

/** The stored batch file cannot be read as format version 1. */
export class BatchFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchFileError';
  }
}

const channels = new Set<string>(Object.values(Channel));

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isItemList(value: unknown): value is RawCollectedItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isObject(item) &&
        'payload' in item &&
        (item.rank === null || typeof item.rank === 'number'),
    )
  );
}

export function serializeBatchFile(file: BatchFile): Buffer {
  return Buffer.from(JSON.stringify(file), 'utf8');
}

/** Reads a stored batch, or throws `BatchFileError` naming what is wrong. */
export function parseBatchFile(data: Buffer): BatchFile {
  let value: unknown;
  try {
    value = JSON.parse(data.toString('utf8'));
  } catch {
    throw new BatchFileError('batch file is not valid JSON');
  }
  if (!isObject(value)) throw new BatchFileError('batch file is not an object');
  if (value.formatVersion !== 1)
    throw new BatchFileError(
      `unknown batch format version ${String(value.formatVersion)}`,
    );
  if (typeof value.channel !== 'string' || !channels.has(value.channel))
    throw new BatchFileError('batch file has an unknown channel');
  for (const field of ['batchId', 'segmentRunId', 'observedAt'])
    if (typeof value[field] !== 'string')
      throw new BatchFileError(`batch file is missing ${field}`);
  if (
    !isObject(value.itemsByQuery) ||
    !Object.values(value.itemsByQuery).every(isItemList)
  )
    throw new BatchFileError('batch file is missing itemsByQuery');
  if (!isItemList(value.unattributed))
    throw new BatchFileError('batch file is missing unattributed');
  if (!isObject(value.source) || !Array.isArray(value.queries))
    throw new BatchFileError('batch file is missing source or queries');
  return value as unknown as BatchFile;
}

/** `<channel>/<yyyy-mm-dd UTC>/<segmentRunId>.json` */
export function batchStorageKey(
  channel: Channel,
  observedAt: Date,
  segmentRunId: string,
): string {
  return `${channel}/${observedAt.toISOString().slice(0, 10)}/${segmentRunId}.json`;
}
