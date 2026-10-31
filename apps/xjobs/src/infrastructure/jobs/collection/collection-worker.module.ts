import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateChannelWorkerEnvironment } from 'src/config';
import { DatabaseModule } from 'src/database';
import { CollectorsModule } from 'src/modules/collectors';
import { IngestModule } from 'src/modules/ingest';
import { QuerySearchModule } from 'src/modules/queries';
import { RedisSettingsModule } from '../../redis/settings.module';
import { AshbyCollectionJob } from './ashby.job';
import { GreenhouseCollectionJob } from './greenhouse.job';
import { LinkedinJobBoardCollectionJob } from './linkedin-job-board.job';
import { LinkedinPostsCollectionJob } from './linkedin-posts.job';

/**
 * A channel worker process. Every channel's job is available; `worker.ts`
 * starts only the one `WORKER_CHANNEL` names.
 */
@Module({
  imports: [
    // This process does not import AppModule, so it validates its own env.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true,
      validate: validateChannelWorkerEnvironment,
    }),
    DatabaseModule,
    RedisSettingsModule,
    QuerySearchModule,
    CollectorsModule,
    IngestModule,
  ],
  providers: [
    AshbyCollectionJob,
    GreenhouseCollectionJob,
    LinkedinJobBoardCollectionJob,
    LinkedinPostsCollectionJob,
  ],
})
export class CollectionWorkerModule {}
