import { ApiProperty } from '@nestjs/swagger';

export class ToolUpdateWorkerDto {
  @ApiProperty()
  workerId: string;

  @ApiProperty()
  workerName: string;

  @ApiProperty({
    enum: ['ready', 'pending', 'updating', 'succeeded', 'failed'],
  })
  state: 'ready' | 'pending' | 'updating' | 'succeeded' | 'failed';

  @ApiProperty({ required: false })
  installedVersion?: string;

  @ApiProperty({ required: false })
  targetVersion?: string;

  @ApiProperty({ required: false })
  error?: string;
}

export class ToolUpdateRolloutDto {
  @ApiProperty()
  requestId: string;

  @ApiProperty()
  requestedVersion: string;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    format: 'date-time',
  })
  requestedAt?: Date | null;

  @ApiProperty()
  totalWorkers: number;

  @ApiProperty()
  pending: number;

  @ApiProperty()
  updating: number;

  @ApiProperty()
  succeeded: number;

  @ApiProperty()
  failed: number;

  @ApiProperty({ type: () => [ToolUpdateWorkerDto] })
  workers: ToolUpdateWorkerDto[];
}

export class ToolUpdateComponentDto {
  @ApiProperty()
  component: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty({ enum: ['managed', 'worker_image', 'external'] })
  mode: 'managed' | 'worker_image' | 'external';

  @ApiProperty({ type: [String] })
  installedVersions: string[];

  @ApiProperty({ required: false, nullable: true, type: String })
  latestVersion?: string | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  releaseUrl?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    format: 'date-time',
  })
  lastCheckedAt?: Date | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  checkError?: string | null;

  @ApiProperty()
  updateAvailable: boolean;

  @ApiProperty({ type: () => ToolUpdateRolloutDto, required: false })
  rollout?: ToolUpdateRolloutDto;
}
