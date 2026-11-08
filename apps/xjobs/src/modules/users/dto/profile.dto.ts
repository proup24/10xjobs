import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmpty,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  LANGUAGE_LEVELS,
  type LanguageLevel,
  SALARY_PERIODS,
  type SalaryPeriod,
  type SpokenLanguage,
} from '../types/place.types';
import { LocationsDto } from './locations.dto';
import { SkillDto } from './skill.dto';
import {
  CODE,
  CURRENCY_CODE,
  HasLocation,
  IsGreaterOrEqual,
  LANGUAGE_CODE,
  UniqueBy,
} from './validators';

/** UTC offsets in minutes: UTC-12:00 to UTC+14:00. */
const MIN_OFFSET = -720;
const MAX_OFFSET = 840;

/** The largest salary minimum: `salaryMin` is an int4 column. */
const MAX_SALARY = 2_147_483_647;

export const POSITION_IMMUTABLE =
  'position cannot be changed; delete this profile and create one for the new position';

/**
 * Decorators for a non-empty set of value-list codes. The DTO checks the
 * shape only; the database refuses a code that is not approved.
 */
function CodeSet(list: string, example: string[]) {
  const decorators = [
    ApiProperty({
      type: [String],
      example,
      description: `Approved ${list} codes; the database checks them`,
    }),
    IsArray(),
    ArrayNotEmpty(),
    ArrayMaxSize(50),
    ArrayUnique(),
    IsString({ each: true }),
    MaxLength(64, { each: true }),
    Matches(CODE, { each: true, message: `$property must hold ${list} codes` }),
  ];
  return (target: object, propertyName: string) => {
    for (const decorate of decorators) decorate(target, propertyName);
  };
}

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

/** Every profile field except `position`, which is fixed when the profile is created. */
export class ProfileFieldsDto {
  @ApiProperty({
    type: [SpokenLanguageDto],
    description: 'One entry per language',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SpokenLanguageDto)
  @UniqueBy(['lang'])
  languages!: SpokenLanguageDto[];

  @ApiProperty({
    type: LocationsDto,
    description:
      'Where to search, per arrangement. An empty list means that arrangement is not wanted; at least one place is required.',
  })
  @IsObject()
  @ValidateNested()
  @Type(() => LocationsDto)
  @HasLocation()
  locations!: LocationsDto;

  @ApiProperty({ minimum: 0, maximum: 60 })
  @IsInt()
  @Min(0)
  @Max(60)
  yearsOfExperience!: number;

  @ApiProperty({ description: 'Current UTC offset in minutes', example: 60 })
  @IsInt()
  @Min(MIN_OFFSET)
  @Max(MAX_OFFSET)
  timezoneCurrent!: number;

  @ApiProperty({
    description: 'Lowest accepted UTC offset in minutes',
    example: -240,
  })
  @IsInt()
  @Min(MIN_OFFSET)
  @Max(MAX_OFFSET)
  timezoneMin!: number;

  @ApiProperty({
    description: 'Highest accepted UTC offset in minutes',
    example: 240,
  })
  @IsInt()
  @Min(MIN_OFFSET)
  @Max(MAX_OFFSET)
  @IsGreaterOrEqual('timezoneMin')
  timezoneMax!: number;

  @CodeSet('engagements', ['employee', 'contractor'])
  engagements!: string[];

  @CodeSet('seniorities', ['senior', 'staff'])
  seniorities!: string[];

  @CodeSet('contract_types', ['full_time', 'contract'])
  contractTypes!: string[];

  @ApiPropertyOptional({
    type: SalaryDto,
    nullable: true,
    description: 'The lowest salary wanted; leave out or null for no rule',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SalaryDto)
  salary?: SalaryDto | null;

  @ApiProperty({
    description:
      'True to accept any currency, with an empty acceptedCurrencies; false with at least one',
  })
  @IsBoolean()
  acceptsAnyCurrency!: boolean;

  @ApiProperty({ type: [String], example: ['EUR', 'MAD'] })
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(CURRENCY_CODE, {
    each: true,
    message: 'acceptedCurrencies must hold ISO 4217 codes',
  })
  acceptedCurrencies!: string[];

  @ApiProperty({ minimum: 0, maximum: 365 })
  @IsInt()
  @Min(0)
  @Max(365)
  noticePeriodDays!: number;

  @ApiProperty({ type: [SkillDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SkillDto)
  @UniqueBy(['technology', 'domain'])
  techStack!: SkillDto[];
}

export class CreateProfileDto extends ProfileFieldsDto {
  @ApiProperty({
    example: 'backend_engineer',
    description:
      'An approved engineering role_kinds code: the one position this profile targets. It cannot be changed later: delete the profile and create another one instead.',
  })
  @IsString()
  @MaxLength(64)
  @Matches(CODE, { message: 'position must be a role_kinds code' })
  position!: string;
}

/** A full replacement of a profile's editable fields. The position is not editable. */
export class ReplaceProfileDto extends ProfileFieldsDto {
  // Undocumented on purpose: declared only so a sent position gets a clear 400.
  @IsEmpty({ message: POSITION_IMMUTABLE })
  position?: never;
}
