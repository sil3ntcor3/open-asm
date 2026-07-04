import { WORKER_TOKEN_HEADER } from '@/common/constants/app.constants';
import { Public, WorkspaceId } from '@/common/decorators/app.decorator';
import { WorkerTokenAuth } from '@/common/decorators/worker-token-auth.decorator';
import { Doc } from '@/common/doc/doc.decorator';
import { DefaultMessageResponseDto } from '@/common/dtos/default-message-response.dto';
import {
  GetManyBaseQueryParams,
  GetManyBaseResponseDto,
} from '@/common/dtos/get-many-base.dto';
import { IdQueryParamDto } from '@/common/dtos/id-query-param.dto';
import { GrpcWorkerContext } from '@/common/guards/grpc-worker-context.service';
import { GrpcWorkerTokenGuard } from '@/common/guards/grpc-worker-token.guard';
import { WorkspaceOwnerGuard } from '@/common/guards/workspace-owner.guard';
import { GetManyResponseDto } from '@/utils/getManyResponse';
import { Metadata } from '@grpc/grpc-js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { plainToInstance } from 'class-transformer';
import { Asset } from '../assets/entities/assets.entity';
import { WorkerInstance } from '../workers/entities/worker.entity';
import { GetManyJobsRequestDto } from './dto/get-many-jobs-dto';
import { JobHistoryDetailResponseDto } from './dto/job-history-detail.dto';
import { JobHistoryResponseDto } from './dto/job-history.dto';
import {
  GetNextJobResponseDto,
  JobTimelineResponseDto,
  UpdateResultDto,
  WorkerControlResponseDto,
  WorkerIdParams,
} from './dto/jobs-registry.dto';
import { Job } from './entities/job.entity';
import { JobsRegistryService } from './jobs-registry.service';

/** HTTP request after WorkerTokenGuard has attached the validated worker. */
type WorkerAuthedRequest = { workerInstance?: WorkerInstance };

@Controller('jobs-registry')
export class JobsRegistryController {
  constructor(
    private readonly jobsRegistryService: JobsRegistryService,
    private readonly grpcWorkerContext: GrpcWorkerContext,
  ) {}

  /**
   * Resolves the worker ID from the token validated by GrpcWorkerTokenGuard,
   * ignoring any worker_id in the request body. This prevents an
   * authenticated worker from pulling, controlling, or reporting results for
   * another worker's jobs by spoofing the ID field.
   */
  private authenticatedWorkerId(metadata: Metadata): string {
    const workerToken = metadata.get(WORKER_TOKEN_HEADER)?.[0] as
      | string
      | undefined;
    const worker = workerToken
      ? this.grpcWorkerContext.getWorker(workerToken)
      : undefined;

    if (!worker) {
      throw new RpcException('Worker not found in context');
    }

    return worker.id;
  }

  @Doc({
    summary: 'Get Jobs',
    description: 'Retrieves a list of jobs that the user is a member of.',
    response: {
      serialization: GetManyResponseDto(Job),
    },
  })
  @Get('')
  getManyJobs(@Query() query: GetManyJobsRequestDto) {
    return this.jobsRegistryService.getManyJobs(query);
  }

  @Doc({
    summary: 'Get Jobs Timeline',
    description:
      'Retrieves a timeline of jobs grouped by tool name and target.',
    response: {
      serialization: JobTimelineResponseDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Get('/timeline')
  getJobsTimeline(@WorkspaceId() workspaceId: string) {
    return this.jobsRegistryService.getJobsTimeline(workspaceId);
  }

  @Doc({
    summary:
      'Retrieves the next job associated with the given worker that has not yet been started.',
    response: {
      serialization: GetNextJobResponseDto,
    },
  })
  @WorkerTokenAuth()
  @Public()
  @Get('/:workerId/next')
  async getNextJob(
    @Param() { workerId }: WorkerIdParams,
    @Req() req: WorkerAuthedRequest,
  ) {
    // Use the ID bound to the validated token, not the path param, so a
    // worker cannot pull another worker's jobs by spoofing the path.
    const job = await this.jobsRegistryService.getNextJob(
      req.workerInstance?.id ?? workerId,
    );
    return job;
  }

  @Doc({ summary: 'Updates the result of a job with the given worker ID.' })
  @WorkerTokenAuth()
  @Public()
  @Post('/:workerId/result')
  updateResult(
    @Param() { workerId }: WorkerIdParams,
    @Body() dto: UpdateResultDto,
    @Req() req: WorkerAuthedRequest,
  ) {
    // Bind to the validated token's worker (this endpoint previously trusted
    // the unauthenticated path workerId, letting anyone submit results for
    // any worker's job).
    return this.jobsRegistryService.updateResult(
      req.workerInstance?.id ?? workerId,
      dto,
    );
  }

  @Doc({
    summary: 'Get Many Job Histories',
    description:
      'Retrieves a list of job histories in the current workspace with their associated jobs, assets, and targets.',
    response: {
      serialization: GetManyResponseDto(JobHistoryResponseDto),
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Get('/histories')
  getManyJobHistories(
    @WorkspaceId() workspaceId: string,
    @Query() query: GetManyBaseQueryParams,
  ): Promise<GetManyBaseResponseDto<JobHistoryResponseDto>> {
    return this.jobsRegistryService.getManyJobHistories(workspaceId, query);
  }

  @Doc({
    summary: 'Get Job History Detail',
    description:
      'Retrieves a job history detail with its associated workflow and jobs.',
    response: {
      serialization: JobHistoryDetailResponseDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Get('/histories/:id')
  getJobHistoryDetail(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
  ): Promise<JobHistoryDetailResponseDto> {
    return this.jobsRegistryService.getJobHistoryDetail(workspaceId, id);
  }

  @UseGuards(WorkspaceOwnerGuard)
  @Doc({
    summary: 'Re-run a job',
    description:
      'Reset job status to pending, clear workerId, and increment retry count',
    response: {
      serialization: DefaultMessageResponseDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Post('/:id/re-run')
  reRunJob(
    @WorkspaceId() workspaceId: string,
    @Param() params: IdQueryParamDto,
  ) {
    return this.jobsRegistryService.reRunJob(workspaceId, params.id);
  }

  @UseGuards(WorkspaceOwnerGuard)
  @Doc({
    summary: 'Cancel a job',
    description: 'Cancel a job by its ID in the specified workspace',
    response: {
      serialization: DefaultMessageResponseDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Post('/:id/cancel')
  cancelJob(
    @WorkspaceId() workspaceId: string,
    @Param() params: IdQueryParamDto,
  ) {
    return this.jobsRegistryService.cancelJob(workspaceId, params.id);
  }

  @UseGuards(WorkspaceOwnerGuard)
  @Doc({
    summary: 'Pause a job',
    description:
      'Pause a pending or in-progress job. Pending jobs are excluded from dispatch; in-progress jobs are stopped on the worker and can be resumed later.',
    response: {
      serialization: DefaultMessageResponseDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Post('/:id/pause')
  pauseJob(
    @WorkspaceId() workspaceId: string,
    @Param() params: IdQueryParamDto,
  ) {
    return this.jobsRegistryService.pauseJob(workspaceId, params.id);
  }

  @UseGuards(WorkspaceOwnerGuard)
  @Doc({
    summary: 'Resume a paused job',
    description:
      'Resume a paused job. Jobs paused while running continue on their worker if it is still alive, otherwise they are requeued.',
    response: {
      serialization: DefaultMessageResponseDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Post('/:id/resume')
  resumeJob(
    @WorkspaceId() workspaceId: string,
    @Param() params: IdQueryParamDto,
  ) {
    return this.jobsRegistryService.resumeJob(workspaceId, params.id);
  }

  @UseGuards(WorkspaceOwnerGuard)
  @Doc({
    summary: 'Delete a job',
    description: 'Delete a job by its ID in the specified workspace',
    response: {
      serialization: DefaultMessageResponseDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Delete('/:id')
  deleteJob(
    @WorkspaceId() workspaceId: string,
    @Param() params: IdQueryParamDto,
  ) {
    return this.jobsRegistryService.deleteJob(workspaceId, params.id);
  }

  @UseGuards(GrpcWorkerTokenGuard)
  @GrpcMethod('JobsRegistryService', 'Next')
  async next(
    _worker: { id: string },
    metadata: Metadata,
  ): Promise<{ id: string; asset: Asset; command?: string }> {
    // Use the ID bound to the validated token, not the client-supplied one.
    const workerId = this.authenticatedWorkerId(metadata);
    const job = await this.jobsRegistryService.getNextJob(workerId);

    if (!job) {
      return { id: '', asset: {} as Asset, command: '' };
    }

    return {
      id: job.id,
      asset: job.asset,
      command: job.command,
    };
  }

  /**
   * Worker control poll: the worker reports the job IDs it is currently
   * executing and receives per-job directives (stop/pause/resume) plus its
   * desired runtime settings (max concurrency, dispatch pause).
   */
  @UseGuards(GrpcWorkerTokenGuard)
  @GrpcMethod('JobsRegistryService', 'Control')
  async control(
    request: { workerId: string; activeJobIds?: string[] },
    metadata: Metadata,
  ): Promise<WorkerControlResponseDto> {
    const workerId = this.authenticatedWorkerId(metadata);
    return this.jobsRegistryService.getWorkerControl(
      workerId,
      request.activeJobIds ?? [],
    );
  }

  @UseGuards(GrpcWorkerTokenGuard)
  @GrpcMethod('JobsRegistryService', 'Result')
  async result(
    { data }: { workerId: string; data: UpdateResultDto },
    metadata: Metadata,
  ): Promise<{ success: boolean }> {
    const workerId = this.authenticatedWorkerId(metadata);
    const transformedData = plainToInstance(UpdateResultDto, data, {
      enableImplicitConversion: true,
      excludeExtraneousValues: true,
    });
    const result = await this.jobsRegistryService.updateResult(
      workerId,
      transformedData,
    );
    if (!result.jobId)
      return {
        success: false,
      };

    return {
      success: true,
    };
  }
}
