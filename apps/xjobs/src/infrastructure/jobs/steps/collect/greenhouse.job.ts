import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  GreenhouseCollector,
  type BoardSearchRunConfig,
} from 'src/modules/collectors';
import { QuerySearchService } from 'src/modules/queries';
import { SearchSegmentsRepository } from 'src/modules/segments';
import { StorageService } from 'src/modules/storage';
import { channelJobsConfig } from '../../config';
import { IngestQueue } from '../ingest';
import { CollectionJob } from './collection.job';

@Injectable()
export class GreenhouseCollectionJob extends CollectionJob<BoardSearchRunConfig> {
  readonly channel = Channel.GREEN_HOUSE;
  readonly queueName = 'collect-greenhouse';
  readonly config = channelJobsConfig[Channel.GREEN_HOUSE];

  constructor(
    collector: GreenhouseCollector,
    queries: QuerySearchService,
    segments: SearchSegmentsRepository,
    storage: StorageService,
    ingestQueue: IngestQueue,
  ) {
    super(collector, queries, segments, storage, ingestQueue);
  }
}
