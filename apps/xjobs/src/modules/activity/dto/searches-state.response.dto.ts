import { ApiProperty } from '@nestjs/swagger';

export class SearchesStateResponseDto {
  @ApiProperty({
    description: "Whether the user's searches that only they need are paused",
  })
  paused!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: "The user's latest activity, or null when there is none",
  })
  lastActiveAt!: string | null;
}
