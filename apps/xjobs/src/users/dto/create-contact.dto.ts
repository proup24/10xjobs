import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ContactKind } from 'src/common/enums';
import { IsContactValue } from './validators';

export class CreateContactDto {
  @ApiProperty({ enum: ContactKind, enumName: 'ContactKind' })
  @IsEnum(ContactKind)
  kind!: ContactKind;

  @ApiProperty({
    description:
      'E.164 for phone, an email for email, an http(s) URL for links',
  })
  @IsContactValue()
  value!: string;

  @ApiPropertyOptional({ example: 'personal' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
