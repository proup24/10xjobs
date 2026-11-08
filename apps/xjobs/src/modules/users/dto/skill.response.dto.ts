import { ApiProperty } from '@nestjs/swagger';
import { SkillDomain } from 'src/common/enums';

export class SkillResponseDto {
  @ApiProperty({ example: 'nodejs', description: 'A tech_tags code' })
  technology!: string;

  @ApiProperty({ enum: SkillDomain, enumName: 'SkillDomain' })
  domain!: SkillDomain;

  @ApiProperty({ minimum: 0, maximum: 10, description: 'How well you know it' })
  mastery!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 10,
    description: 'How much this technology should drive searches; 0 never',
  })
  importance!: number;
}
