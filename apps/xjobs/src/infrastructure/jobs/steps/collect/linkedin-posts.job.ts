import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  LinkedinPostsCollector,
  type LinkedinPostsRunConfig,
} from 'src/modules/collectors';
import { QuerySearchService } from 'src/modules/queries';
import { SearchSegmentsRepository } from 'src/modules/segments';
import { StorageService } from 'src/modules/storage';
import { channelJobsConfig } from '../../config';
import { IngestQueue } from '../ingest';
import { CollectionJob } from './collection.job';

@Injectable()
export class LinkedinPostsCollectionJob extends CollectionJob<LinkedinPostsRunConfig> {
  readonly channel = Channel.LINKEDIN_POSTS;
  readonly queueName = 'collect-linkedin-posts';
  readonly config = channelJobsConfig[Channel.LINKEDIN_POSTS];

  constructor(
    collector: LinkedinPostsCollector,
    queries: QuerySearchService,
    segments: SearchSegmentsRepository,
    storage: StorageService,
    ingestQueue: IngestQueue,
  ) {
    super(collector, queries, segments, storage, ingestQueue);
  }
}
