import { ApiProperty } from '@nestjs/swagger';
import {
  Arrangement,
  Engagement,
  Language,
  Position,
  ProfileState,
  Region,
  Seniority,
} from 'src/common/enums';
import type { ProfileView } from '../types';
import { SkillDto } from './skill.dto';

export class ResumeInfoResponseDto {
  @ApiProperty({ example: 'cv.pdf' })
  filename!: string;

  @ApiProperty()
  sizeBytes!: number;

  @ApiProperty({ description: 'SHA-256 of the file, hex' })
  sha256!: string;

  @ApiProperty({ format: 'date-time' })
  uploadedAt!: Date;
}

export class ProfileResponseDto implements ProfileView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ enum: Position, enumName: 'Position', isArray: true })
  positions!: Position[];

  @ApiProperty({ enum: Language, enumName: 'Language', isArray: true })
  languages!: Language[];

  @ApiProperty({ example: 'MA' })
  country!: string;

  @ApiProperty({ type: String, nullable: true })
  city!: string | null;

  @ApiProperty({ enum: Region, enumName: 'Region', isArray: true })
  regions!: Region[];

  @ApiProperty()
  yearsOfExperience!: number;

  @ApiProperty({ description: 'UTC offset in minutes' })
  timezoneCurrent!: number;

  @ApiProperty({ description: 'UTC offset in minutes' })
  timezoneMin!: number;

  @ApiProperty({ description: 'UTC offset in minutes' })
  timezoneMax!: number;

  @ApiProperty({ enum: Engagement, enumName: 'Engagement', isArray: true })
  engagements!: Engagement[];

  @ApiProperty({ enum: Arrangement, enumName: 'Arrangement', isArray: true })
  arrangements!: Arrangement[];

  @ApiProperty({ enum: Seniority, enumName: 'Seniority' })
  seniority!: Seniority;

  @ApiProperty()
  noticePeriodDays!: number;

  @ApiProperty({
    type: [SkillDto],
    description: 'Ordered by preference, then mastery',
  })
  techStack!: SkillDto[];

  @ApiProperty({ type: ResumeInfoResponseDto, nullable: true })
  resume!: ResumeInfoResponseDto | null;

  @ApiProperty({ enum: ProfileState, enumName: 'ProfileState' })
  state!: ProfileState;

  @ApiProperty({ format: 'date-time', type: Date, nullable: true })
  publishedAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
