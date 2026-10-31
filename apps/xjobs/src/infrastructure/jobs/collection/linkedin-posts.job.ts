import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  LinkedinPostsCollector,
  type LinkedinPostsRunConfig,
} from 'src/modules/collectors';
import { IngestService } from 'src/modules/ingest';
import { QuerySearchService } from 'src/modules/queries';
import { SearchSegmentsRepository } from 'src/modules/segments';
import { channelJobsConfig } from '../config';
import { CollectionJob } from './collection.job';

@Injectable()
export class LinkedinPostsCollectionJob extends CollectionJob<LinkedinPostsRunConfig> {
  readonly channel = Channel.LINKEDIN_POSTS;
  readonly queueName = 'collect-linkedin-posts';
  readonly config = channelJobsConfig[Channel.LINKEDIN_POSTS];

  constructor(
    collector: LinkedinPostsCollector,
    queries: QuerySearchService,
    ingest: IngestService,
    segments: SearchSegmentsRepository,
  ) {
    super(collector, queries, ingest, segments);
  }
}
