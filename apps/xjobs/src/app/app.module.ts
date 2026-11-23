import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpExceptionFilter } from 'src/common/filters';
import { ResponseInterceptor } from 'src/common/interceptors';
import { validateEnvironment } from 'src/config';
import { DatabaseModule } from 'src/database';
import { RedisModule } from 'src/infrastructure/redis/redis.module';
import { JobsModule } from 'src/infrastructure/jobs/jobs.module';
import { AdminModule } from 'src/modules/admin/admin.module';
import { SearchesModule } from 'src/modules/activity';
import { UsersModule } from 'src/modules/users';
import { AuthModule } from 'src/modules/auth';
import { HealthController } from './controllers/health.controller';
import { HealthService } from './services/health.service';
import { operatorImports } from './operator.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // `src/environment.ts` already loaded the env files into process.env.
      ignoreEnvFile: true,
      validate: validateEnvironment,
    }),
    AuthModule,
    DatabaseModule,
    RedisModule,
    JobsModule,
    UsersModule,
    SearchesModule,
    AdminModule,
    // Processor, matcher and query-search routes, local only. The workers run
    // in their own process (src/worker.ts), so the API never consumes jobs.
    ...operatorImports(process.env),
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
