import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO31661Alpha2,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class AddressDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  line1!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string | null;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string | null;

  @ApiProperty({ example: 'MA', description: 'ISO 3166-1 alpha-2, uppercase' })
  @Matches(/^[A-Z]{2}$/, { message: 'country must be two uppercase letters' })
  @IsISO31661Alpha2()
  country!: string;
}
