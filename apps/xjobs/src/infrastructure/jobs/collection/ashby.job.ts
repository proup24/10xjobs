import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import { AshbyCollector } from 'src/modules/collectors';
import { IngestService } from 'src/modules/ingest';
import { QuerySearchService } from 'src/modules/queries';
import { CollectionJob } from './collection.job';

@Injectable()
export class AshbyCollectionJob extends CollectionJob {
  readonly channel = Channel.ASHBY;
  readonly queueName = 'collect-ashby';

  constructor(
    collector: AshbyCollector,
    queries: QuerySearchService,
    ingest: IngestService,
  ) {
    super(collector, queries, ingest);
  }
}
