import { Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { PubSubService } from './pubsub.service';
import { RedisConnections } from './redis-connections';
import { RedisSettingsModule } from './redis-settings.module';

@Module({
  imports: [RedisSettingsModule],
  providers: [RedisConnections, CacheService, PubSubService],
  exports: [CacheService, PubSubService],
})
export class RedisModule {}
