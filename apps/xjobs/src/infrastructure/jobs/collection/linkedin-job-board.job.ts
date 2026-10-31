import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import { LinkedinJobBoardCollector } from 'src/modules/collectors';
import { IngestService } from 'src/modules/ingest';
import { QuerySearchService } from 'src/modules/queries';
import { CollectionJob } from './collection.job';

@Injectable()
export class LinkedinJobBoardCollectionJob extends CollectionJob {
  readonly channel = Channel.LINKEDIN_JOB_BOARD;
  readonly queueName = 'collect-linkedin-job-board';

  constructor(
    collector: LinkedinJobBoardCollector,
    queries: QuerySearchService,
    ingest: IngestService,
  ) {
    super(collector, queries, ingest);
  }
}
