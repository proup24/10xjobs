import { ApiProperty } from '@nestjs/swagger';
import { SkillDomain, Technology } from 'src/common/enums';

export class SkillResponseDto {
  @ApiProperty({ enum: Technology, enumName: 'Technology' })
  technology!: Technology;

  @ApiProperty({ enum: SkillDomain, enumName: 'SkillDomain' })
  domain!: SkillDomain;

  @ApiProperty({ minimum: 0, maximum: 10, description: 'How well you know it' })
  mastery!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 10,
    description: 'How much you want to work with it',
  })
  preference!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 10,
    description: 'How much this technology should drive searches; 0 never',
  })
  importance!: number;
}
