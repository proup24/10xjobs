import { ApiProperty } from '@nestjs/swagger';
import { ProfileState } from 'src/common/enums';
import type { ProfileView } from '../types';
import { LocationsDto } from './locations.dto';
import { SalaryDto, SpokenLanguageDto } from './profile.dto';
import { SkillResponseDto } from './skill.response.dto';

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
  userId!: string;

  @ApiProperty({
    example: 'backend_engineer',
    description: 'A role_kinds code',
  })
  position!: string;

  @ApiProperty({ type: [SpokenLanguageDto] })
  languages!: SpokenLanguageDto[];

  @ApiProperty({ type: LocationsDto })
  locations!: LocationsDto;

  @ApiProperty()
  yearsOfExperience!: number;

  @ApiProperty({ description: 'UTC offset in minutes' })
  timezoneCurrent!: number;

  @ApiProperty({ description: 'UTC offset in minutes' })
  timezoneMin!: number;

  @ApiProperty({ description: 'UTC offset in minutes' })
  timezoneMax!: number;

  @ApiProperty({ type: [String], example: ['employee'] })
  engagements!: string[];

  @ApiProperty({ type: [String], example: ['senior'] })
  seniorities!: string[];

  @ApiProperty({ type: [String], example: ['full_time'] })
  contractTypes!: string[];

  @ApiProperty({ type: SalaryDto, nullable: true })
  salary!: SalaryDto | null;

  @ApiProperty()
  acceptsAnyCurrency!: boolean;

  @ApiProperty({ type: [String], example: ['EUR'] })
  acceptedCurrencies!: string[];

  @ApiProperty()
  noticePeriodDays!: number;

  @ApiProperty({
    type: [SkillResponseDto],
    description: 'Ordered by importance, then mastery',
  })
  techStack!: SkillResponseDto[];

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
