import { Module } from '@nestjs/common';
import { CollectorsModule } from 'src/modules/collectors';
import { IngestModule } from 'src/modules/ingest';
import { QuerySearchModule } from 'src/modules/queries';
import { SearchSegmentsModule } from 'src/modules/segments';
import { RedisSettingsModule } from '../redis/settings.module';
import {
  AshbyCollectionJob,
  GreenhouseCollectionJob,
  LinkedinJobBoardCollectionJob,
  LinkedinPostsCollectionJob,
} from './collection';
import { JobsService } from './jobs.service';

const COLLECTION_JOBS = [
  AshbyCollectionJob,
  GreenhouseCollectionJob,
  LinkedinJobBoardCollectionJob,
  LinkedinPostsCollectionJob,
];

/**
 * Declares and executes the jobs: the infrastructure queue producer and one
 * collection job per channel. Worker processes live in `infrastructure/worker`.
 */
@Module({
  imports: [
    RedisSettingsModule,
    QuerySearchModule,
    CollectorsModule,
    IngestModule,
    SearchSegmentsModule,
  ],
  providers: [JobsService, ...COLLECTION_JOBS],
  exports: [JobsService, ...COLLECTION_JOBS],
})
export class JobsModule {}
