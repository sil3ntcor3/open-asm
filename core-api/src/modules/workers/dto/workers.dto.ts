import { GetManyBaseQueryParams } from '@/common/dtos/get-many-base.dto';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsObject,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class WorkerManifestResponseDto {
  @ApiProperty({
    description: 'Commands to initialize worker tools',
    example: ['nuclei -ut'],
    type: [String],
  })
  initCommands: string[];
}

export class WorkerMetadataDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  os?: string;
}

export class WorkerJoinDto {
  @ApiProperty()
  @IsString()
  apiKey: string;

  @ApiProperty({ required: false })
  @IsString()
  signature: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  token?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  ipAddress?: string;

  @ApiProperty({ required: false, type: () => WorkerMetadataDto })
  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkerMetadataDto)
  metadata?: WorkerMetadataDto;
}

export class WorkerAliveDto {
  @ApiProperty()
  @IsString()
  token: string;
}

export class GetManyWorkersDto extends GetManyBaseQueryParams {
  @ApiProperty({ required: false })
  @IsUUID('4')
  @IsOptional()
  workspaceId?: string;

  @ApiProperty({ required: false, enum: ['cloud', 'workspace'] })
  @IsString()
  @IsOptional()
  scope?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  })
  enabledAgentMode?: boolean;
}

export class UpdateWorkerSettingsDto {
  /**
   * Desired number of concurrent jobs for this worker. Delivered on the
   * worker's next control poll; shrinking takes effect as running jobs
   * finish (running jobs are never killed). Null resets the worker to its
   * local WORKER_MAX_CONCURRENCY configuration.
   */
  @ApiProperty({ required: false, nullable: true, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxConcurrency?: number | null;

  /**
   * Pause/start the whole worker: a paused worker is handed no new jobs
   * and suspends its polling. Running jobs are not affected.
   */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPaused?: boolean;
}
