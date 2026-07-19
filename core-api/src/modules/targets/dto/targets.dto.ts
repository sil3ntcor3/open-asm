import { GetManyBaseQueryParams } from '@/common/dtos/get-many-base.dto';
import { CronSchedule, JobStatus, ScanStatus, TargetScopeType } from '@/common/enums/enum';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMilitaryTime,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Target, TargetType } from '../entities/target.entity';

export class CreateTargetDto {
  @ApiProperty({
    example: 'example.com',
    description: 'The target value (domain, IP address, or CIDR notation)',
  })
  @IsString()
  value: string;

  @ApiProperty({
    enum: TargetType,
    enumName: 'TargetType',
    description: 'The type of target (DOMAIN, CIDR, or IP)',
    example: TargetType.DOMAIN,
    required: false,
    default: TargetType.DOMAIN,
  })
  @IsEnum(TargetType)
  @IsOptional()
  type?: TargetType = TargetType.DOMAIN;
}

/**
 * DTO for creating multiple targets in a single request
 */
export class CreateMultipleTargetsDto {
  @ApiProperty({
    description:
      'Array of target values to create. Supports DOMAIN (root domain), CIDR (/24 range only), and IP (single IP address) types.',
    type: [CreateTargetDto],
    example: [
      { value: 'example.com', type: 'DOMAIN' },
      { value: '192.168.1.0/24', type: 'CIDR' },
      { value: '8.8.8.8', type: 'IP' },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTargetDto)
  targets: CreateTargetDto[];

  @ApiProperty({
    description:
      'Whether to start discovery workflows for the created targets. Defaults to true. Set to false to register targets without scanning them.',
    required: false,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  startDiscovery?: boolean = true;
}

/**
 * DTO representing the result of a bulk target creation operation
 */
export class BulkTargetResultDto {
  @ApiProperty({
    description: 'List of successfully created targets',
    type: [Target],
  })
  created: Target[];

  @ApiProperty({
    description: 'List of target values that were skipped (already exist)',
    example: ['existing.com', 'duplicate.com'],
  })
  skipped: string[];

  @ApiProperty({
    description: 'Total number of targets requested to create',
    example: 10,
  })
  @IsInt()
  totalRequested: number;

  @ApiProperty({
    description: 'Total number of targets successfully created',
    example: 8,
  })
  @IsInt()
  totalCreated: number;

  @ApiProperty({
    description: 'Total number of targets skipped (duplicates)',
    example: 2,
  })
  @IsInt()
  totalSkipped: number;
}

export class GetManyTargetResponseDto {
  @ApiProperty()
  @IsUUID('4')
  id: string;

  @ApiProperty()
  value: string;

  @ApiProperty({ enum: TargetType, enumName: 'TargetType' })
  type: TargetType;

  @ApiProperty()
  reScanCount: number;

  @ApiProperty({ enum: CronSchedule })
  scanSchedule: CronSchedule;

  @ApiProperty({ enum: ScanStatus, example: ScanStatus.DONE })
  status?: ScanStatus;

  @ApiProperty({ example: 100 })
  totalAssetServices: number;

  @ApiProperty()
  duration: number;

  @ApiProperty()
  lastDiscoveredAt: Date;

  @ApiProperty()
  internalNetworkId: string;
}

export class GetManyWorkspaceQueryParamsDto extends GetManyBaseQueryParams {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  value?: string;

  @ApiProperty({
    required: false,
    enum: TargetType,
    enumName: 'TargetType',
    description: 'Filter by target type (DOMAIN, CIDR, or IP)',
  })
  @IsEnum(TargetType)
  @IsOptional()
  type?: TargetType;

  @ApiProperty({
    required: false,
    enum: JobStatus,
    enumName: 'JobStatus',
    description:
      'Filter by scan status (pending, in_progress, completed, failed, cancelled)',
  })
  @IsEnum(JobStatus)
  @IsOptional()
  status?: JobStatus;

  @ApiProperty({
    required: false,
    enum: TargetScopeType,
    enumName: 'TargetScopeType',
    description: 'Filter by target scope (INTERNAL or EXTERNAL)',
  })
  @IsEnum(TargetScopeType)
  @IsOptional()
  scope?: TargetScopeType;
}

export class UpdateTargetDto {
  @ApiProperty({ required: false, enum: CronSchedule })
  @IsString()
  @IsEnum(CronSchedule)
  @IsOptional()
  scanSchedule?: CronSchedule;

  /**
   * Start of the execution window (HH:MM, evaluated in scanWindowTimezone).
   * Jobs for this target are only dispatched to workers while the window is
   * open; both start and end must be set for the window to apply. Set both
   * to null to return to continuous scanning.
   */
  @ApiProperty({ required: false, nullable: true, type: String, example: '22:00' })
  @IsOptional()
  @IsMilitaryTime()
  scanWindowStart?: string | null;

  @ApiProperty({ required: false, nullable: true, type: String, example: '06:00' })
  @IsOptional()
  @IsMilitaryTime()
  scanWindowEnd?: string | null;

  /**
   * IANA timezone the window is evaluated in. Validated here because an
   * unknown zone name would make the dispatch query error at runtime.
   */
  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    example: 'America/Chicago',
  })
  @IsOptional()
  @IsTimeZone()
  scanWindowTimezone?: string | null;

  /** ISO days of week (1 = Monday … 7 = Sunday); null/empty = every day. */
  @ApiProperty({ required: false, nullable: true, type: [Number], example: [6, 7] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  scanWindowDays?: number[] | null;
}

/**
 * DTO for starting discovery on existing targets in bulk
 */
export class DiscoverTargetsDto {
  @ApiProperty({
    description: 'IDs of the targets to start discovery on',
    type: [String],
    example: ['4b3b9c2e-1f2a-4d5e-8f6a-7b8c9d0e1f2a'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  targetIds: string[];
}

export class SkippedTargetDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  value: string;

  @ApiProperty({ example: 'already scanning' })
  reason: string;
}

/**
 * DTO representing the result of a bulk discovery request
 */
export class DiscoverTargetsResultDto {
  @ApiProperty({
    description: 'Number of targets discovery was started on',
    example: 3,
  })
  @IsInt()
  totalStarted: number;

  @ApiProperty({
    description: 'Number of targets skipped (already scanning)',
    example: 1,
  })
  @IsInt()
  totalSkipped: number;

  @ApiProperty({
    description: 'Details of skipped targets',
    type: [SkippedTargetDto],
  })
  skipped: SkippedTargetDto[];
}
