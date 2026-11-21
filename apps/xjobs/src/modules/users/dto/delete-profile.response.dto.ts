import { ApiProperty } from '@nestjs/swagger';

export class DeleteProfileResponseDto {
  @ApiProperty({ format: 'uuid', description: 'The deleted profile' })
  id!: string;
}
