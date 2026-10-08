import { JobStatus, ToolCategory } from '@/common/enums/enum';
import { Asset } from '@/modules/assets/entities/assets.entity';
import { Target } from '@/modules/targets/entities/target.entity';
import { Tool } from '@/modules/tools/entities/tools.entity';
import { ApiProperty } from '@nestjs/swagger';

export class JobHistoryJobItemDetail {
  @ApiProperty()
  id: string;

  @ApiProperty()
  status?: JobStatus;

  @ApiProperty()
  category: ToolCategory;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty()
  completedAt?: Date;

  @ApiProperty()
  pickJobAt?: Date;

  @ApiProperty()
  priority?: number;

  @ApiProperty()
  command?: string;

  @ApiProperty()
  isSaveRawResult?: boolean;

  @ApiProperty()
  isSaveData?: boolean;

  @ApiProperty()
  isPublishEvent?: boolean;

  @ApiProperty()
  retryCount?: number;

  @ApiProperty({ type: () => Tool })
  tool?: Tool;

  @ApiProperty({ type: () => Asset })
  asset?: Asset;

  @ApiProperty({ type: () => Target })
  target?: Target;

  @ApiProperty({ type: () => [String] })
  errorLogs?: string[];

  @ApiProperty()
  workerId?: string;
}

/**
 * Aggregate job counts for one workflow step of a run.
 *
 * The pipeline indicator used to derive each step's state from the first page of
 * the paginated job list. That silently breaks on any sizeable run: a 338-asset
 * discovery has thousands of jobs, and because the list is ordered with active
 * work first, page one holds only the currently-running step — every finished
 * step vanishes from the payload and renders as "pending" forever. These counts
 * summarise the whole run in a handful of rows, so step state no longer depends
 * on what happens to fit on a page.
 */
export class JobHistoryStepDetail {
  @ApiProperty()
  toolId: string;

  @ApiProperty()
  toolName: string;

  @ApiProperty()
  total: number;

  @ApiProperty()
  pending: number;

  @ApiProperty()
  inProgress: number;

  @ApiProperty()
  paused: number;

  @ApiProperty()
  completed: number;

  @ApiProperty()
  failed: number;

  @ApiProperty()
  cancelled: number;
}

export class JobHistoryDetailResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: () => [Tool] })
  tools?: Tool[];

  /** Per-step job counts, in workflow order and aligned with `tools`. */
  @ApiProperty({ type: () => [JobHistoryStepDetail] })
  steps?: JobHistoryStepDetail[];

  @ApiProperty()
  workflowName?: string;

  @ApiProperty()
  jobHistoryName?: string;
}
