import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  LinkedinJobBoardCollector,
  type LinkedinJobBoardRunConfig,
} from 'src/modules/collectors';
import { IngestService } from 'src/modules/ingest';
import { QuerySearchService } from 'src/modules/queries';
import { SearchSegmentsRepository } from 'src/modules/segments';
import { channelJobsConfig } from '../config';
import { CollectionJob } from './collection.job';

@Injectable()
export class LinkedinJobBoardCollectionJob extends CollectionJob<LinkedinJobBoardRunConfig> {
  readonly channel = Channel.LINKEDIN_JOB_BOARD;
  readonly queueName = 'collect-linkedin-job-board';
  readonly config = channelJobsConfig[Channel.LINKEDIN_JOB_BOARD];

  constructor(
    collector: LinkedinJobBoardCollector,
    queries: QuerySearchService,
    ingest: IngestService,
    segments: SearchSegmentsRepository,
  ) {
    super(collector, queries, ingest, segments);
  }
}
