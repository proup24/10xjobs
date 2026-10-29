import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, Max, Min } from 'class-validator';
import { SkillDomain, Technology } from 'src/common/enums';

export class SkillDto {
  @ApiProperty({ enum: Technology, enumName: 'Technology' })
  @IsEnum(Technology)
  technology!: Technology;

  @ApiProperty({ enum: SkillDomain, enumName: 'SkillDomain' })
  @IsEnum(SkillDomain)
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
