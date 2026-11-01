import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import { StorageModule } from 'src/modules/storage';
import {
  PrismaRawStorageRepository,
  RawStorageRepository,
} from './repositories/raw.repository';
import { BatchIngestService } from './services/batch.service';

/** Ingests stored collection batches into raw storage. */
@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [
    BatchIngestService,
    { provide: RawStorageRepository, useClass: PrismaRawStorageRepository },
  ],
  exports: [BatchIngestService, RawStorageRepository],
})
export class IngestModule {}
