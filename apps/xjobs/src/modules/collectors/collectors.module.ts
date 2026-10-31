import { Module } from '@nestjs/common';
import { AshbyProvider } from './providers/ashby.provider';
import { GreenhouseProvider } from './providers/greenhouse.provider';
import { LinkedinJobBoardProvider } from './providers/linkedin-job-board.provider';
import { LinkedinPostsProvider } from './providers/linkedin-posts.provider';
import { Collector } from './types/collector';

export const COLLECTOR_PROVIDERS = Symbol('COLLECTOR_PROVIDERS');

@Module({
  providers: [
    AshbyProvider,
    GreenhouseProvider,
    LinkedinJobBoardProvider,
    LinkedinPostsProvider,
    {
      provide: COLLECTOR_PROVIDERS,
      useFactory: (...providers: Collector[]) => providers,
      inject: [
        AshbyProvider,
        GreenhouseProvider,
        LinkedinJobBoardProvider,
        LinkedinPostsProvider,
      ],
    },
  ],
  exports: [COLLECTOR_PROVIDERS],
})
export class CollectorsModule {}
