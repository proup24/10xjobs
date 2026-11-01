import { Module } from '@nestjs/common';
import { CollectorsModule } from 'src/modules/collectors';
import { QuerySearchModule } from 'src/modules/queries';
import { SearchSegmentsModule } from 'src/modules/segments';
import { StorageModule } from 'src/modules/storage';
import { RedisSettingsModule } from '../redis/settings.module';
import {
  AshbyCollectionJob,
  GreenhouseCollectionJob,
  LinkedinJobBoardCollectionJob,
  LinkedinPostsCollectionJob,
} from './collection';
import { IngestQueue } from './steps';
import { JobsService } from './jobs.service';

const COLLECTION_JOBS = [
  AshbyCollectionJob,
  GreenhouseCollectionJob,
  LinkedinJobBoardCollectionJob,
  LinkedinPostsCollectionJob,
];

/**
 * Declares and executes the jobs: the infrastructure queue producer and one
 * collection job per channel, and the producer of the ingest queue. Worker processes live in `infrastructure/worker`.
 */
@Module({
  imports: [
    RedisSettingsModule,
    QuerySearchModule,
    CollectorsModule,
    SearchSegmentsModule,
    StorageModule,
  ],
  providers: [JobsService, IngestQueue, ...COLLECTION_JOBS],
  exports: [JobsService, IngestQueue, ...COLLECTION_JOBS],
})
export class JobsModule {}
