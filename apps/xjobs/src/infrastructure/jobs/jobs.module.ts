import { Module } from '@nestjs/common';
import { RedisSettingsModule } from '../redis/settings.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [RedisSettingsModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
