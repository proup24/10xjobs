import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpExceptionFilter } from 'src/common/filters';
import { BASIC_AUTH_CREDENTIALS, BasicAuthGuard } from 'src/common/guards';
import { ResponseInterceptor } from 'src/common/interceptors';
import {
  getBasicAuthConfig,
  validateEnvironment,
  type EnvironmentVariables,
} from 'src/config';
import { DatabaseModule } from 'src/database';
import { RedisModule } from 'src/infrastructure/redis/redis.module';
import { JobsModule } from 'src/infrastructure/jobs/jobs.module';
import { QuerySearchModule } from 'src/modules/queries';
import { UsersModule } from 'src/modules/users';
import { HealthController } from './controllers/health.controller';
import { HealthService } from './services/health.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // `src/environment.ts` already loaded the env files into process.env.
      ignoreEnvFile: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    RedisModule,
    JobsModule,
    UsersModule,
    QuerySearchModule,
    // WorkerModule,
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: BASIC_AUTH_CREDENTIALS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        getBasicAuthConfig(config),
    },
    { provide: APP_GUARD, useClass: BasicAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
