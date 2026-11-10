import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpExceptionFilter } from 'src/common/filters';
import { ResponseInterceptor } from 'src/common/interceptors';
import { validateEnvironment } from 'src/config';
import { DatabaseModule } from 'src/database';
import { RedisModule } from 'src/infrastructure/redis/redis.module';
import { JobsModule } from 'src/infrastructure/jobs/jobs.module';
import { MatcherModule } from 'src/modules/matcher';
import { ProcessorModule } from 'src/modules/processor';
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
    // The processor's HTTP routes only. The workers run in their own process
    // (src/worker.ts), so the API never consumes jobs.
    ProcessorModule,
    // The matcher's HTTP routes only, like the processor's.
    MatcherModule,
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
