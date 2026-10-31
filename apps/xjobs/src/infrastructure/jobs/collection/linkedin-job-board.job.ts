import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  LinkedinJobBoardCollector,
  type LinkedinJobBoardRunConfig,
} from 'src/modules/collectors';
import { QuerySearchService } from 'src/modules/queries';
import { SearchSegmentsRepository } from 'src/modules/segments';
import { StorageService } from 'src/modules/storage';
import { channelJobsConfig } from '../config';
import { IngestQueue } from '../ingest-queue.service';
import { CollectionJob } from './collection.job';

@Injectable()
export class LinkedinJobBoardCollectionJob extends CollectionJob<LinkedinJobBoardRunConfig> {
  readonly channel = Channel.LINKEDIN_JOB_BOARD;
  readonly queueName = 'collect-linkedin-job-board';
  readonly config = channelJobsConfig[Channel.LINKEDIN_JOB_BOARD];

  constructor(
    collector: LinkedinJobBoardCollector,
    queries: QuerySearchService,
    segments: SearchSegmentsRepository,
    storage: StorageService,
    ingestQueue: IngestQueue,
  ) {
    super(collector, queries, segments, storage, ingestQueue);
  }
}
