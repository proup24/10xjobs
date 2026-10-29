import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import {
  SKILL_DOMAINS,
  TECHNOLOGIES,
  type SkillDomain,
  type Technology,
} from 'src/common/enums';

export class SkillDto {
  @ApiProperty({ enum: TECHNOLOGIES })
  @IsIn(TECHNOLOGIES)
  technology!: Technology;

  @ApiProperty({ enum: SKILL_DOMAINS })
  @IsIn(SKILL_DOMAINS)
  domain!: SkillDomain;

  @ApiProperty({ minimum: 0, maximum: 10, description: 'How well you know it' })
  @IsInt()
  @Min(0)
  @Max(10)
  mastery!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 10,
    description: 'How much you want to work with it',
  })
  @IsInt()
  @Min(0)
  @Max(10)
  preference!: number;
}
