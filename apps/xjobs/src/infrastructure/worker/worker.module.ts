import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateWorkerProcessEnvironment } from 'src/config';
import { DatabaseModule } from 'src/database';
import { JobsModule } from 'src/infrastructure/jobs/jobs.module';
import { RedisSettingsModule } from 'src/infrastructure/redis/settings.module';
import { IngestModule } from 'src/modules/ingest';
import { StorageModule } from 'src/modules/storage';
import { WorkerService } from './worker.service';

/**
 * The worker process: consumes the jobs the jobs module declares. One process
 * runs the infrastructure queue, one channel's collection job, or ingest.
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
    IngestModule,
    StorageModule,
  ],
  providers: [WorkerService],
})
export class WorkerModule {}
