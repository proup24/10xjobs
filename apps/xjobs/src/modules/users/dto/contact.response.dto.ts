import { ApiProperty } from '@nestjs/swagger';
import { ContactKind } from 'src/common/enums';
import type { ContactRow } from 'src/database';

export class ContactResponseDto implements ContactRow {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ enum: ContactKind, enumName: 'ContactKind' })
  kind!: ContactKind;

  @ApiProperty()
  value!: string;

  @ApiProperty({ type: String, nullable: true })
  label!: string | null;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
