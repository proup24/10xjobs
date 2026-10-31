import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import {
  IngestRepository,
  PrismaIngestRepository,
} from './repositories/ingest.repository';
import { IngestService } from './services/ingest.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    IngestService,
    { provide: IngestRepository, useClass: PrismaIngestRepository },
  ],
  exports: [IngestService],
})
export class IngestModule {}
