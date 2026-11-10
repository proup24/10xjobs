import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  type WorkerProcessEnvironmentVariables,
  validateWorkerProcessEnvironment,
} from 'src/config';
import { DatabaseModule } from 'src/database';
import { JobsModule } from 'src/infrastructure/jobs/jobs.module';
import { MatchQueue } from 'src/infrastructure/jobs/steps/match';
import { ProcessQueue } from 'src/infrastructure/jobs/steps/process';
import { RedisSettingsModule } from 'src/infrastructure/redis/settings.module';
import { IngestModule } from 'src/modules/ingest';
import { MatcherModule } from 'src/modules/matcher';
import { ProcessorModule } from 'src/modules/processor';
import { StorageModule } from 'src/modules/storage';
import { CollectionWorkerService } from './collection.service';
import { InfrastructureWorkerService } from './infrastructure.service';
import { IngestWorkerService } from './ingest.service';
import { MatchWorkerService } from './match.service';
import { ProcessorWorkerService } from './processor.service';
import { WorkerRuntimeService } from './runtime.service';
import { RUN_SCHEDULES } from './scheduler';
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
    ProcessorModule,
    MatcherModule,
    StorageModule,
  ],
  providers: [
    {
      provide: RUN_SCHEDULES,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<WorkerProcessEnvironmentVariables, true>,
      ) => config.get('XJOBS_RUN_SCHEDULES', { infer: true }),
    },
    WorkerService,
    WorkerRuntimeService,
    CollectionWorkerService,
    IngestWorkerService,
    ProcessorWorkerService,
    ProcessQueue,
    MatchQueue,
    MatchWorkerService,
    InfrastructureWorkerService,
  ],
})
export class WorkerModule {}
