import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SkillDomain } from 'src/common/enums';
import { CODE } from './validators';

export class SkillDto {
  @ApiProperty({
    example: 'nodejs',
    description: 'An approved tech_tags code; the database checks it',
  })
  @IsString()
  @MaxLength(64)
  @Matches(CODE, { message: 'technology must be a tech_tags code' })
  technology!: string;

  @ApiProperty({ enum: SkillDomain, enumName: 'SkillDomain' })
  @IsEnum(SkillDomain)
  domain!: SkillDomain;

  @ApiProperty({ minimum: 0, maximum: 10, description: 'How well you know it' })
  @IsInt()
  @Min(0)
  @Max(10)
  mastery!: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 10,
    default: 5,
    description: 'How much this technology should drive searches; 0 never',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  importance?: number;
}
