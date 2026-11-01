export { CollectorsModule } from './collectors.module';
export { AshbyCollector } from './providers/ashby.collector';
export { GreenhouseCollector } from './providers/greenhouse.collector';
export { LinkedinJobBoardCollector } from './providers/linkedin-job-board.collector';
export { LinkedinPostsCollector } from './providers/linkedin-posts.collector';
export type {
  ActorRunConfig,
  BoardSearchRunConfig,
  LinkedinJobBoardRunConfig,
  LinkedinPostsRunConfig,
  RawCollectedItem,
  SegmentQuery,
  SegmentResult,
  SegmentSearch,
} from './types/collector';
