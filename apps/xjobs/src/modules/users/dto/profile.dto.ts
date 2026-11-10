import { ApiProperty } from '@nestjs/swagger';
import {
  LANGUAGE_LEVELS,
  type LanguageLevel,
  SALARY_PERIODS,
  type SalaryPeriod,
  type SpokenLanguage,
} from '../types/place.types';

/** The largest salary minimum: `salaryMin` is an int4 column. */
const MAX_SALARY = 2_147_483_647;

export class SpokenLanguageDto implements SpokenLanguage {
  @ApiProperty({ example: 'en', description: 'ISO 639-1, lowercase' })
  lang!: string;

  @ApiProperty({ enum: LANGUAGE_LEVELS })
  level!: LanguageLevel;
}

export class SalaryDto {
  @ApiProperty({
    minimum: 1,
    maximum: MAX_SALARY,
    description: 'Whole currency units',
  })
  min!: number;

  @ApiProperty({ example: 'EUR', description: 'ISO 4217, uppercase' })
  currency!: string;

  @ApiProperty({ enum: SALARY_PERIODS })
  period!: SalaryPeriod;
}
