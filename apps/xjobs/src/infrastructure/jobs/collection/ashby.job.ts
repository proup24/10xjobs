import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  AshbyCollector,
  type BoardSearchRunConfig,
} from 'src/modules/collectors';
import { QuerySearchService } from 'src/modules/queries';
import { SearchSegmentsRepository } from 'src/modules/segments';
import { StorageService } from 'src/modules/storage';
import { channelJobsConfig } from '../config';
import { IngestQueue } from '../steps';
import { CollectionJob } from './collection.job';

@Injectable()
export class AshbyCollectionJob extends CollectionJob<BoardSearchRunConfig> {
  readonly channel = Channel.ASHBY;
  readonly queueName = 'collect-ashby';
  readonly config = channelJobsConfig[Channel.ASHBY];

  constructor(
    collector: AshbyCollector,
    queries: QuerySearchService,
    segments: SearchSegmentsRepository,
    storage: StorageService,
    ingestQueue: IngestQueue,
  ) {
    super(collector, queries, segments, storage, ingestQueue);
  }
}
