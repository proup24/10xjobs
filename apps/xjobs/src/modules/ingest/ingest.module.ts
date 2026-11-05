import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import { StorageModule } from 'src/modules/storage';
import {
  PrismaRawStorageRepository,
  RawStorageRepository,
} from './repositories/raw.repository';
import { BatchFileReaderService } from './services/batch-file-reader.service';
import { BatchItemWriterService } from './services/batch-item-writer.service';
import { BatchIngestService } from './services/batch.service';
import { RenormalizeService } from './services/renormalize.service';

/** Ingests stored collection batches into raw storage and normalized jobs. */
@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [
    BatchIngestService,
    BatchFileReaderService,
    BatchItemWriterService,
    RenormalizeService,
    { provide: RawStorageRepository, useClass: PrismaRawStorageRepository },
  ],
  exports: [BatchIngestService, RawStorageRepository, RenormalizeService],
})
export class IngestModule {}
