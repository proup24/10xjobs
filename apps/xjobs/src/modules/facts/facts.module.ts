import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import {
  PlaceVocabularyRepository,
  PrismaPlaceVocabularyRepository,
} from './places/place-vocabulary.repository';
import {
  FactsRepository,
  PrismaFactsRepository,
} from './repositories/facts.repository';
import { FACTS_CLOCK, FactsService } from './services/facts.service';

/** Builds and stores each job's combined facts. */
@Module({
  imports: [DatabaseModule],
  providers: [
    FactsService,
    { provide: FactsRepository, useClass: PrismaFactsRepository },
    {
      provide: PlaceVocabularyRepository,
      useClass: PrismaPlaceVocabularyRepository,
    },
    { provide: FACTS_CLOCK, useValue: () => new Date() },
  ],
  exports: [FactsService],
})
export class FactsModule {}
