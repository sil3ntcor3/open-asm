import { GetManyBaseQueryParams } from '@/common/dtos/get-many-base.dto';
import { JobRunType, JobStatus, ToolCategory } from '@/common/enums/enum';
import { JobDataResultType } from '@/common/types/app.types';
import { AssetTag } from '@/modules/assets/entities/asset-tags.entity';
import { Asset } from '@/modules/assets/entities/assets.entity';
import { HttpResponse } from '@/modules/assets/entities/http-response.entity';
import { Tool } from '@/modules/tools/entities/tools.entity';
import { Vulnerability } from '@/modules/vulnerabilities/entities/vulnerability.entity';
import { Workflow } from '@/modules/workflows/entities/workflow.entity';
import { ApiProperty, PickType } from '@nestjs/swagger';
import { Expose, Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';
import { JobHistory } from '../entities/job-history.entity';
import { Job } from '../entities/job.entity';

type RawGrpcResponse = {
  error?: boolean;
  raw?: string;
  assets?: Asset[];
  httpResponse?: HttpResponse;
  numbers?: number[];
  vulnerabilities?: Vulnerability[];
  assetTags?: AssetTag[];
};

export class GetNextJobResponseDto extends PickType(Job, [
  'id',
  'category',
  'status',
  'priority',
  'createdAt',
  'updatedAt',
  'command',
  'asset',
]) {}

export class WorkerIdParams {
  @ApiProperty()
  @IsUUID()
  workerId: string;
}

export class DataPayloadResult {
  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  @Expose()
  @Transform(({ value }: { value: boolean }) => value ?? false)
  error: boolean;

  @ApiProperty()
  @IsOptional()
  @Expose()
  @Transform(({ value }: { value: string }) => value ?? null)
  raw?: string | null;

  @ApiProperty()
  @IsOptional()
  @Expose()
  @Transform(
    ({ obj, value }: { obj: RawGrpcResponse; value: JobDataResultType }) => {
      if (value) return value;
      const unwrap = <T>(
        field: T | { values: T } | undefined,
      ): T | undefined => {
        if (!field) return undefined;
        if (typeof field === 'object' && 'values' in field) {
          return field.values;
        }
        return field;
      };

      return (
        unwrap(obj.assets) ??
        unwrap(obj.httpResponse) ??
        unwrap(obj.numbers) ??
        unwrap(obj.vulnerabilities) ??
        unwrap(obj.assetTags)
      );
    },
  )
  payload: JobDataResultType;
}
export class UpdateResultDto {
  @ApiProperty()
  @IsUUID()
  @Expose()
  jobId: string;

  @ApiProperty()
  @IsObject()
  @Type(() => DataPayloadResult)
  @Expose()
  data: DataPayloadResult;
}

export class GetManyJobsQueryParams extends GetManyBaseQueryParams {
  @ApiProperty({
    description: 'Filter jobs by status',
    enum: [...Object.values(JobStatus), 'all'],
    default: 'all',
  })
  @IsIn([...Object.values(JobStatus), 'all'])
  jobStatus: JobStatus | 'all';

  @ApiProperty({
    description: 'Filter jobs by worker name',
    enum: [...Object.values(ToolCategory), 'all'],
    default: 'all',
  })
  @IsIn([...Object.values(ToolCategory), 'all'])
  workerName: ToolCategory | 'all';
}

export class JobTimelineItem {
  @ApiProperty()
  name: string;

  @ApiProperty()
  target: string;

  @ApiProperty()
  targetId: string;

  @ApiProperty()
  jobHistoryId: string;

  @ApiProperty()
  startTime: Date;

  @ApiProperty()
  endTime: Date;

  @ApiProperty()
  status: JobStatus;

  @ApiProperty()
  description?: string;

  @ApiProperty()
  toolCategory?: ToolCategory;

  @ApiProperty()
  duration?: number;
}

/**
 * Represents the raw SQL query result for the jobs timeline query.
 * This interface maps directly to the columns returned by the jobs timeline SQL query.
 */
export interface JobTimelineQueryResult {
  name: string;
  target: string;
  target_id: string;
  jobHistoryId: string;
  start_time: Date;
  end_time: Date;
  statuses: string;
  description: string;
  tool_category: ToolCategory;
  duration_seconds: number;
}

export class JobTimelineResponseDto {
  @ApiProperty({ type: [JobTimelineItem] })
  data: JobTimelineItem[];
}
export class CreateJobsDto {
  @ApiProperty()
  @IsUUID('all', { each: true })
  toolIds: string[];

  @ApiProperty()
  @IsUUID()
  targetId: string;
}

export class CreateJobs extends PickType(Job, [
  'priority',
  'isSaveRawResult',
  'isSaveData',
  'command',
  'isPublishEvent',
] as const) {
  tool: Tool;
  targetIds?: string[];
  assetIds?: string[];
  workspaceId: string;
  workflow: Workflow;
  jobHistory?: JobHistory;
  jobName?: string;
  jobRunType?: JobRunType;
}

/**
 * Per-job control actions delivered to a worker via the gRPC Control poll.
 * Numeric values must stay in sync with `JobControlAction` in
 * `src/proto/jobs_registry.proto`.
 */
export enum JobControlAction {
  NONE = 0,
  /** Kill the running process; core has already marked the job cancelled. */
  STOP = 1,
  /** Stop the running process and leave the job in paused state. */
  PAUSE = 2,
  /** Continue a previously paused process when a worker still has one. */
  RESUME = 3,
}

export interface JobControlDirective {
  jobId: string;
  action: JobControlAction;
}

/** Response payload of the worker control poll (gRPC `Control`). */
export interface WorkerControlResponseDto {
  directives: JobControlDirective[];
  /** Desired concurrent-job limit; 0 = keep the worker's local default. */
  maxConcurrency: number;
  /** Worker-level pause: stop pulling new jobs (running jobs unaffected). */
  dispatchPaused: boolean;
}
