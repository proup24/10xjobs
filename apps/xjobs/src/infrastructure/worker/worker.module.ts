import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  type WorkerProcessEnvironmentVariables,
  validateWorkerProcessEnvironment,
} from 'src/config';
import { EnvironmentType } from 'src/common/enums';
import { DatabaseModule } from 'src/database';
import { JobsModule } from 'src/infrastructure/jobs/jobs.module';
import { MatchQueue } from 'src/infrastructure/jobs/steps/match';
import { ProcessQueue } from 'src/infrastructure/jobs/steps/process';
import { WebhookQueue } from 'src/infrastructure/jobs/steps/webhook';
import { RedisSettingsModule } from 'src/infrastructure/redis/settings.module';
import { FactsModule } from 'src/modules/facts';
import { IngestModule } from 'src/modules/ingest';
import { MatcherModule } from 'src/modules/matcher';
import { ProcessorModule } from 'src/modules/processor';
import { RatesModule } from 'src/modules/rates';
import { StorageModule } from 'src/modules/storage';
import { WebhooksModule } from 'src/modules/webhooks';
import { CollectionWorkerService } from './collection.service';
import { InfrastructureWorkerService } from './infrastructure.service';
import { IngestWorkerService } from './ingest.service';
import { MatchWorkerService } from './match.service';
import { ProcessorWorkerService } from './processor.service';
import { WebhookWorkerService } from './webhook.service';
import { WorkerRuntimeService } from './runtime.service';
import { COLLECT_ON_START, RUN_SCHEDULES } from './scheduler';
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
    FactsModule,
    MatcherModule,
    RatesModule,
    StorageModule,
    WebhooksModule,
  ],
  providers: [
    {
      provide: RUN_SCHEDULES,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<WorkerProcessEnvironmentVariables, true>,
      ) => config.get('XJOBS_RUN_SCHEDULES', { infer: true }),
    },
    {
      provide: COLLECT_ON_START,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<WorkerProcessEnvironmentVariables, true>,
      ) =>
        config.get('NODE_ENV', { infer: true }) === EnvironmentType.development,
    },
    WorkerService,
    WorkerRuntimeService,
    CollectionWorkerService,
    IngestWorkerService,
    ProcessorWorkerService,
    ProcessQueue,
    MatchQueue,
    MatchWorkerService,
    WebhookQueue,
    WebhookWorkerService,
    InfrastructureWorkerService,
  ],
})
export class WorkerModule {}
