import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  AshbyCollector,
  type BoardSearchRunConfig,
} from 'src/modules/collectors';
import { IngestService } from 'src/modules/ingest';
import { QuerySearchService } from 'src/modules/queries';
import { SearchSegmentsRepository } from 'src/modules/segments';
import { channelJobsConfig } from '../config';
import { CollectionJob } from './collection.job';

@Injectable()
export class AshbyCollectionJob extends CollectionJob<BoardSearchRunConfig> {
  readonly channel = Channel.ASHBY;
  readonly queueName = 'collect-ashby';
  readonly config = channelJobsConfig[Channel.ASHBY];

  constructor(
    collector: AshbyCollector,
    queries: QuerySearchService,
    ingest: IngestService,
    segments: SearchSegmentsRepository,
  ) {
    super(collector, queries, ingest, segments);
  }
}
