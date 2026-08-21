import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateFirstAdminDto {
  @ApiProperty()
  @IsEmail()
  email: string;
  @IsString()
  @ApiProperty()
  password: string;
}

export class AuthorizeFirstAdminDto {
  @IsString()
  @MinLength(64)
  ticket: string;
}

export class GetMetadataDto {
  @ApiProperty()
  isInit: boolean;

  @ApiProperty()
  isAssistant: boolean;

  @ApiProperty({ description: 'System name' })
  name: string;

  @ApiProperty({
    description: 'Path to system logo',
    type: String,
    nullable: true,
  })
  logoPath?: string | null;

  @ApiProperty({
    description: 'Current system version',
    type: String,
    nullable: true,
  })
  currentVersion: string | null;
}

export class GetVersionDto {
  @ApiProperty({
    description: 'Current system version',
    type: String,
    nullable: true,
  })
  currentVersion: string | null;

  @ApiProperty({
    description: 'Source commit included in the installed build',
    type: String,
    nullable: true,
  })
  currentCommit: string | null;

  @ApiProperty({
    description: 'Installed release channel',
    type: String,
    nullable: true,
  })
  channel: string | null;

  @ApiProperty({
    description: 'Latest system version',
    type: String,
    nullable: true,
  })
  latestVersion: string | null;

  @ApiProperty({ description: 'Release date', type: String, nullable: true })
  releaseDate: string | null;

  @ApiProperty({ description: 'Release notes', type: String, nullable: true })
  notes: string | null;

  @ApiProperty({
    description: 'Release page URL',
    type: String,
    nullable: true,
  })
  releaseUrl: string | null;

  @ApiProperty({
    description: 'Time of the last successful check',
    type: String,
    nullable: true,
  })
  lastCheckedAt: string | null;

  @ApiProperty({
    description: 'Is latest version',
    type: Boolean,
    nullable: true,
  })
  isLatest: boolean | null;
}
