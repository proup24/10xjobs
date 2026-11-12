import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import { PrismaRatesRepository, RatesRepository } from './rates.repository';
import { RatesService } from './rates.service';

/** Daily exchange rates, per USD, for converting salaries. */
@Module({
  imports: [DatabaseModule],
  providers: [
    RatesService,
    { provide: RatesRepository, useClass: PrismaRatesRepository },
  ],
  exports: [RatesService, RatesRepository],
})
export class RatesModule {}
