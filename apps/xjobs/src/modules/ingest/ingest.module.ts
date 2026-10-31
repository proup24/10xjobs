import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import { IngestRepository, PrismaIngestRepository } from './ingest.repository';
import { IngestService } from './ingest.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    IngestService,
    { provide: IngestRepository, useClass: PrismaIngestRepository },
  ],
  exports: [IngestService],
})
export class IngestModule {}
