import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import { StorageModule } from 'src/modules/storage';
import {
  IngestRepository,
  PrismaIngestRepository,
} from './repositories/ingest.repository';
import {
  PrismaRawStorageRepository,
  RawStorageRepository,
} from './repositories/raw-storage.repository';
import { BatchIngestService } from './services/batch-ingest.service';
import { IngestService } from './services/ingest.service';

@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [
    IngestService,
    BatchIngestService,
    { provide: IngestRepository, useClass: PrismaIngestRepository },
    { provide: RawStorageRepository, useClass: PrismaRawStorageRepository },
  ],
  exports: [IngestService, BatchIngestService, RawStorageRepository],
})
export class IngestModule {}
