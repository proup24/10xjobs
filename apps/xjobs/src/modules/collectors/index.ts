export { COLLECTOR_PROVIDERS, CollectorsModule } from './collectors.module';
export { AshbyCollector } from './providers/ashby.service';
export { GreenhouseCollector } from './providers/greenhouse.service';
export { LinkedinJobBoardCollector } from './providers/linkedin.job_board.service';
export { LinkedinPostsCollector } from './providers/linkedin.posts.service';
export { Collector } from './types/collector';
export type {
  CollectedJob,
  CollectionResult,
  CollectorSearch,
} from './types/collector';
