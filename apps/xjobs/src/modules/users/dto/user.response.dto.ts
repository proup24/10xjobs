import { ApiProperty } from '@nestjs/swagger';
import type { UserRow } from 'src/database';

export class AddressResponseDto {
  @ApiProperty()
  line1!: string;

  @ApiProperty({ type: String, nullable: true })
  line2!: string | null;

  @ApiProperty()
  city!: string;

  @ApiProperty({ type: String, nullable: true })
  postalCode!: string | null;

  @ApiProperty({ type: String, nullable: true })
  state!: string | null;

  @ApiProperty({ example: 'MA' })
  country!: string;
}

export class UserResponseDto implements UserRow {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ example: 'me@example.com' })
  email!: string;

  @ApiProperty({ type: AddressResponseDto, nullable: true })
  address!: AddressResponseDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
