import { Injectable } from '@nestjs/common';
import { StorageService } from 'src/modules/storage';
import { ingestConfig } from '../config';
import type { BatchRecord } from '../repositories/raw.repository';
import type { BatchFile } from '../types';
import { BatchFileError, parseBatchFile } from '../utils';

/** Loads and validates a stored batch file without changing batch status. */
@Injectable()
export class BatchFileReaderService {
  constructor(private readonly storage: StorageService) {}

  async read(batch: BatchRecord): Promise<BatchFile> {
    const file = parseBatchFile(
      await this.storage.get(ingestConfig.bucket, batch.storageKey),
    );
    if (file.channel !== batch.channel)
      throw new BatchFileError('batch file channel mismatch');
    return file;
  }
}
