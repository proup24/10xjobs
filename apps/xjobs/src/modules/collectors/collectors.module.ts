import { Module } from '@nestjs/common';
import { AshbyProvider } from './providers/ashby.provider';
import { GreenhouseProvider } from './providers/greenhouse.provider';
import { LinkedinJobBoardProvider } from './providers/linkedin-job-board.provider';
import { LinkedinPostsProvider } from './providers/linkedin-posts.provider';
import { ChannelProvider } from './types/channel-provider';

export const CHANNEL_PROVIDERS = Symbol('CHANNEL_PROVIDERS');

@Module({
  providers: [
    AshbyProvider,
    GreenhouseProvider,
    LinkedinJobBoardProvider,
    LinkedinPostsProvider,
    { provide: CHANNEL_PROVIDERS, useFactory: (...providers: ChannelProvider[]) => providers,
      inject: [AshbyProvider, GreenhouseProvider, LinkedinJobBoardProvider, LinkedinPostsProvider] },
  ],
  exports: [CHANNEL_PROVIDERS],
})
export class ChannelsModule {}
