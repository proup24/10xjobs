import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import {
  PrefilterRepository,
  PrismaPrefilterRepository,
} from './repositories/prefilter.repository';
import { PrefilterService } from './services/prefilter.service';

/**
 * The check before the LLM: skips `pending` listings no published profile
 * could take, before the processor claims them.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    PrefilterService,
    { provide: PrefilterRepository, useClass: PrismaPrefilterRepository },
  ],
  exports: [PrefilterService, PrefilterRepository],
})
export class PrefilterModule {}
