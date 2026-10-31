import { Inject, Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import type { RedisConfig } from 'src/config';
import { GreenhouseCollector } from 'src/modules/collectors';
import { IngestService } from 'src/modules/ingest';
import { QuerySearchService } from 'src/modules/queries';
import { REDIS_SETTINGS } from '../../redis/settings.module';
import { CollectionJob } from './collection.job';

@Injectable()
export class GreenhouseCollectionJob extends CollectionJob {
  readonly channel = Channel.GREEN_HOUSE;
  readonly queueName = 'collect-greenhouse';

  constructor(
    collector: GreenhouseCollector,
    queries: QuerySearchService,
    ingest: IngestService,
    @Inject(REDIS_SETTINGS) redis: RedisConfig,
  ) {
    super(collector, queries, ingest, redis);
  }
}
