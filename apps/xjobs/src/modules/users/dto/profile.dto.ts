import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Matches, Max, Min } from 'class-validator';
import {
  LANGUAGE_LEVELS,
  type LanguageLevel,
  SALARY_PERIODS,
  type SalaryPeriod,
  type SpokenLanguage,
} from '../types/place.types';
import { CURRENCY_CODE, LANGUAGE_CODE } from './validators';

/** The largest salary minimum: `salaryMin` is an int4 column. */
const MAX_SALARY = 2_147_483_647;

export class SpokenLanguageDto implements SpokenLanguage {
  @ApiProperty({ example: 'en', description: 'ISO 639-1, lowercase' })
  @IsString()
  @Matches(LANGUAGE_CODE, { message: 'lang must be two lowercase letters' })
  lang!: string;

  @ApiProperty({ enum: LANGUAGE_LEVELS })
  @IsIn(LANGUAGE_LEVELS)
  level!: LanguageLevel;
}

export class SalaryDto {
  @ApiProperty({
    minimum: 1,
    maximum: MAX_SALARY,
    description: 'Whole currency units',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_SALARY)
  min!: number;

  @ApiProperty({ example: 'EUR', description: 'ISO 4217, uppercase' })
  @IsString()
  @Matches(CURRENCY_CODE, {
    message: 'currency must be three uppercase letters',
  })
  currency!: string;

  @ApiProperty({ enum: SALARY_PERIODS })
  @IsIn(SALARY_PERIODS)
  period!: SalaryPeriod;
}
