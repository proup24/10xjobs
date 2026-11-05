import { Module } from '@nestjs/common';
import { CollectorsModule } from 'src/modules/collectors';
import { QuerySearchModule } from 'src/modules/queries';
import { SearchSegmentsModule } from 'src/modules/segments';
import { StorageModule } from 'src/modules/storage';
import { RedisSettingsModule } from '../redis/settings.module';
import { CollectionService, IngestQueue } from './steps';
import { JobsService } from './jobs.service';

/**
 * Declares and executes the jobs: the infrastructure queue producer and the
 * collection coordinator, and the producer of the ingest queue. Worker processes live in `infrastructure/worker`.
 */
@Module({
  imports: [
    RedisSettingsModule,
    QuerySearchModule,
    CollectorsModule,
    SearchSegmentsModule,
    StorageModule,
  ],
  providers: [JobsService, IngestQueue, CollectionService],
  exports: [JobsService, IngestQueue, CollectionService],
})
export class JobsModule {}
