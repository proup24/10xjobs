import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateWorkerProcessEnvironment } from 'src/config';
import { DatabaseModule } from 'src/database';
import { JobsModule } from 'src/infrastructure/jobs/jobs.module';
import { RedisSettingsModule } from 'src/infrastructure/redis/settings.module';
import { WorkerService } from './worker.service';

/**
 * The worker process: consumes the jobs the jobs module declares. One process
 * runs either the infrastructure queue or one channel's collection job.
 */
@Module({
  imports: [
    // This process does not import AppModule, so it validates its own env.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true,
      validate: validateWorkerProcessEnvironment,
    }),
    DatabaseModule,
    RedisSettingsModule,
    JobsModule,
  ],
  providers: [WorkerService],
})
export class WorkerModule {}
