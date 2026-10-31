import { Module } from '@nestjs/common';
import { AshbyCollector } from './providers/ashby.collector';
import { GreenhouseCollector } from './providers/greenhouse.collector';
import { LinkedinJobBoardCollector } from './providers/linkedin-job-board.collector';
import { LinkedinPostsCollector } from './providers/linkedin-posts.collector';
import { Collector } from './types/collector';

export const COLLECTOR_PROVIDERS = Symbol('COLLECTOR_PROVIDERS');

@Module({
  providers: [
    AshbyCollector,
    GreenhouseCollector,
    LinkedinJobBoardCollector,
    LinkedinPostsCollector,
    {
      provide: COLLECTOR_PROVIDERS,
      useFactory: (...providers: Collector[]) => providers,
      inject: [
        AshbyCollector,
        GreenhouseCollector,
        LinkedinJobBoardCollector,
        LinkedinPostsCollector,
      ],
    },
  ],
  exports: [COLLECTOR_PROVIDERS],
})
export class CollectorsModule {}
