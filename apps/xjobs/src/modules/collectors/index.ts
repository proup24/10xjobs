export { CollectorsModule } from './collectors.module';
export { AshbyCollector } from './providers/ashby.service';
export { GreenhouseCollector } from './providers/greenhouse.service';
export { LinkedinJobBoardCollector } from './providers/linkedin.job_board.service';
export { LinkedinPostsCollector } from './providers/linkedin.posts.service';
export { Collector } from './types/collector';
export type {
  ActorRunConfig,
  BoardSearchRunConfig,
  CollectedJob,
  LinkedinJobBoardRunConfig,
  LinkedinPostsRunConfig,
  RawCollectedItem,
  SegmentQuery,
  SegmentResult,
  SegmentSearch,
} from './types/collector';
