import { Module } from '@nestjs/common';
import { AshbyCollector } from './providers/ashby.service';
import { GreenhouseCollector } from './providers/greenhouse.service';
import { LinkedinJobBoardCollector } from './providers/linkedin.job_board.service';
import { LinkedinPostsCollector } from './providers/linkedin.posts.service';
import { ApifyActorProvider } from './providers/apify/apify.provider';
import { GoogleJobsSearchProvider } from './providers/apify/google_search.collector';
import { LinkedinJobSearchProvider } from './providers/apify/linkedin.job_search.collector';
import { LinkedinPostSearchProvider } from './providers/apify/linkedin.post_search.collector';
import { AshbyPostingProvider } from './providers/extraction/ashby.provider';
import { GreenhousePostingProvider } from './providers/extraction/greenhouse.provider';
import { Collector } from './types/collector';

export const COLLECTOR_PROVIDERS = Symbol('COLLECTOR_PROVIDERS');

@Module({
  providers: [
    ApifyActorProvider,
    GoogleJobsSearchProvider,
    LinkedinJobSearchProvider,
    LinkedinPostSearchProvider,
    AshbyPostingProvider,
    GreenhousePostingProvider,
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
  exports: [COLLECTOR_PROVIDERS, ApifyActorProvider],
})
export class CollectorsModule {}
