import { ApiProperty } from '@nestjs/swagger';
import type { WorkspaceRow } from 'src/database';

export class WorkspaceResponseDto implements WorkspaceRow {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'default' })
  name!: string;

  @ApiProperty({ example: 'default' })
  slug!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
