import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateWorkerEnvironment } from '../../config';
import { RedisSettingsModule } from '../redis/redis-settings.module';
import { WorkerService } from './worker.service';

@Module({
  imports: [
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
