import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import { LinkedinPostsCollector } from 'src/modules/collectors';
import { IngestService } from 'src/modules/ingest';
import { QuerySearchService } from 'src/modules/queries';
import { CollectionJob } from './collection.job';

@Injectable()
export class LinkedinPostsCollectionJob extends CollectionJob {
  readonly channel = Channel.LINKEDIN_POSTS;
  readonly queueName = 'collect-linkedin-posts';

  constructor(
    collector: LinkedinPostsCollector,
    queries: QuerySearchService,
    ingest: IngestService,
  ) {
    super(collector, queries, ingest);
  }
}
