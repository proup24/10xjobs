import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  GreenhouseCollector,
  type BoardSearchRunConfig,
} from 'src/modules/collectors';
import { IngestService } from 'src/modules/ingest';
import { QuerySearchService } from 'src/modules/queries';
import { SearchSegmentsRepository } from 'src/modules/segments';
import { channelJobsConfig } from '../config';
import { CollectionJob } from './collection.job';

@Injectable()
export class GreenhouseCollectionJob extends CollectionJob<BoardSearchRunConfig> {
  readonly channel = Channel.GREEN_HOUSE;
  readonly queueName = 'collect-greenhouse';
  readonly config = channelJobsConfig[Channel.GREEN_HOUSE];

  constructor(
    collector: GreenhouseCollector,
    queries: QuerySearchService,
    ingest: IngestService,
    segments: SearchSegmentsRepository,
  ) {
    super(collector, queries, ingest, segments);
  }
}
