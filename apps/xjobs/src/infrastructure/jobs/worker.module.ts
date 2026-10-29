import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateWorkerEnvironment } from '../../config';
import { RedisSettingsModule } from '../redis/settings.module';
import { WorkerService } from './worker.service';

@Module({
  imports: [
    // This process does not import AppModule, so it must initialize ConfigService
    // itself using the shared schema (including defaults and number coercion).
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true,
      validate: validateWorkerEnvironment,
    }),
    RedisSettingsModule,
  ],
  providers: [WorkerService],
})
export class WorkerModule {}
