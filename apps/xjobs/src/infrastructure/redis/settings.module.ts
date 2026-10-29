import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRedisConfig, type RedisEnvironmentVariables } from 'src/config';

export const REDIS_SETTINGS = Symbol('REDIS_SETTINGS');

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<RedisEnvironmentVariables, true>) =>
        getRedisConfig(config),
    },
  ],
  exports: [REDIS_SETTINGS],
})
export class RedisSettingsModule {}
