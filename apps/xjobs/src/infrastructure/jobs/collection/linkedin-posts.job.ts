import { Inject, Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import type { RedisConfig } from 'src/config';
import { LinkedinPostsCollector } from 'src/modules/collectors';
import { IngestService } from 'src/modules/ingest';
import { QuerySearchService } from 'src/modules/queries';
import { REDIS_SETTINGS } from '../../redis/settings.module';
import { CollectionJob } from './collection.job';

@Injectable()
export class LinkedinPostsCollectionJob extends CollectionJob {
  readonly channel = Channel.LINKEDIN_POSTS;
  readonly queueName = 'collect-linkedin-posts';

  constructor(
    collector: LinkedinPostsCollector,
    queries: QuerySearchService,
    ingest: IngestService,
    @Inject(REDIS_SETTINGS) redis: RedisConfig,
  ) {
    super(collector, queries, ingest, redis);
  }
}
