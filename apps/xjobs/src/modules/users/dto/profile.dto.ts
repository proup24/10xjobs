import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsISO31661Alpha2,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  Arrangement,
  Engagement,
  Language,
  Position,
  Region,
  Seniority,
} from 'src/common/enums';
import { SkillDto } from './skill.dto';
import { IsGreaterOrEqual, UniqueBy } from './validators';

/** UTC offsets in minutes: UTC-12:00 to UTC+14:00. */
const MIN_OFFSET = -720;
const MAX_OFFSET = 840;

export class UpsertProfileDto {
  @ApiProperty({ enum: Position, enumName: 'Position', isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(Position, { each: true })
  positions!: Position[];

  @ApiProperty({ enum: Language, enumName: 'Language', isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(Language, { each: true })
  languages!: Language[];

  @ApiProperty({ example: 'MA', description: 'ISO 3166-1 alpha-2, uppercase' })
  @Matches(/^[A-Z]{2}$/, { message: 'country must be two uppercase letters' })
  @IsISO31661Alpha2()
  country!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @ApiProperty({ enum: Region, enumName: 'Region', isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(Region, { each: true })
  regions!: Region[];

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

  @ApiProperty({ enum: Engagement, enumName: 'Engagement', isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(Engagement, { each: true })
  engagements!: Engagement[];

  @ApiProperty({ enum: Arrangement, enumName: 'Arrangement', isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(Arrangement, { each: true })
  arrangements!: Arrangement[];

  @ApiProperty({ enum: Seniority, enumName: 'Seniority' })
  @IsEnum(Seniority)
  seniority!: Seniority;

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
