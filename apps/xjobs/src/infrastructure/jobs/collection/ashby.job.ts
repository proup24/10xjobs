import { Inject, Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import type { RedisConfig } from 'src/config';
import { AshbyCollector } from 'src/modules/collectors';
import { IngestService } from 'src/modules/ingest';
import { QuerySearchService } from 'src/modules/queries';
import { REDIS_SETTINGS } from '../../redis/settings.module';
import { CollectionJob } from './collection.job';

@Injectable()
export class AshbyCollectionJob extends CollectionJob {
  readonly channel = Channel.ASHBY;
  readonly queueName = 'collect-ashby';

  constructor(
    collector: AshbyCollector,
    queries: QuerySearchService,
    ingest: IngestService,
    @Inject(REDIS_SETTINGS) redis: RedisConfig,
  ) {
    super(collector, queries, ingest, redis);
  }
}
