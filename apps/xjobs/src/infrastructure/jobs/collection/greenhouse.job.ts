import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import { GreenhouseCollector } from 'src/modules/collectors';
import { IngestService } from 'src/modules/ingest';
import { QuerySearchService } from 'src/modules/queries';
import { CollectionJob } from './collection.job';

@Injectable()
export class GreenhouseCollectionJob extends CollectionJob {
  readonly channel = Channel.GREEN_HOUSE;
  readonly queueName = 'collect-greenhouse';

  constructor(
    collector: GreenhouseCollector,
    queries: QuerySearchService,
    ingest: IngestService,
  ) {
    super(collector, queries, ingest);
  }
}
