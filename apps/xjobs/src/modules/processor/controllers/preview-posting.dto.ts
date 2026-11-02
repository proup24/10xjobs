import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** A job posting to run through the extraction without storing anything. */
export class PreviewPostingDto {
  @ApiPropertyOptional({ example: 'Senior Backend Engineer' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ example: 'Acme' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  companyName?: string;

  @ApiProperty({
    description:
      'The posting text. Longer than 30,000 bytes is cut at a paragraph boundary.',
    example:
      'Remote within the EU. You will build NestJS and PostgreSQL services. 5+ years of TypeScript.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  description!: string;

  @ApiPropertyOptional({
    description: "LinkedIn's location field: context only, never copied.",
    example: 'Berlin, Germany',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  location?: string;

  @ApiPropertyOptional({ example: 'Full-time' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contractType?: string;

  @ApiPropertyOptional({ example: 'Mid-Senior level' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  experienceLevel?: string;
}
