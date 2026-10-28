import { WORKER_TOKEN_HEADER } from '@/common/constants/app.constants';
import type { GrpcWorkerContext } from '@/common/guards/grpc-worker-context.service';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import { Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import type { Asset } from '../assets/entities/assets.entity';
import type { WorkerInstance } from '../workers/entities/worker.entity';
import type {
  GetNextJobResponseDto,
  UpdateResultDto,
} from './dto/jobs-registry.dto';
import { JobsRegistryController } from './jobs-registry.controller';
import type { JobsRegistryService } from './jobs-registry.service';

describe('JobsRegistryController worker protocol', () => {
  it('includes the typed execution plan in the gRPC Next response', async () => {
    const job = {
      id: 'job-1',
      asset: { id: 'asset-1' } as Asset,
      command: 'nuclei -u {{value}}',
      execution: {
        toolName: 'nuclei',
        target: 'example.com',
      },
    } as GetNextJobResponseDto;
    const jobsRegistryService = {
      getNextJob: jest.fn().mockResolvedValue(job),
    } as unknown as JobsRegistryService;
    const grpcWorkerContext = {
      getWorker: jest
        .fn()
        .mockReturnValue({ id: 'worker-1' } as WorkerInstance),
    } as unknown as GrpcWorkerContext;
    const controller = new JobsRegistryController(
      jobsRegistryService,
      grpcWorkerContext,
    );
    const metadata = new Metadata();
    metadata.set(WORKER_TOKEN_HEADER, 'worker-token');

    await expect(controller.next({ id: 'spoofed-worker' }, metadata)).resolves.toEqual(
      {
        id: job.id,
        asset: job.asset,
        command: job.command,
        execution: job.execution,
      },
    );
  });
});

describe('JobsRegistryController result intake', () => {
  const buildController = (updateResult: jest.Mock) => {
    const jobsRegistryService = {
      updateResult,
    } as unknown as JobsRegistryService;
    const grpcWorkerContext = {
      getWorker: jest
        .fn()
        .mockReturnValue({ id: 'worker-1' } as WorkerInstance),
    } as unknown as GrpcWorkerContext;
    return new JobsRegistryController(jobsRegistryService, grpcWorkerContext);
  };

  const metadata = () => {
    const md = new Metadata();
    md.set(WORKER_TOKEN_HEADER, 'worker-token');
    return md;
  };

  const request = {
    workerId: 'worker-1',
    data: { jobId: 'job-1', data: {} },
  } as unknown as { workerId: string; data: UpdateResultDto };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports success when the result is accepted', async () => {
    const controller = buildController(
      jest.fn().mockResolvedValue({ jobId: 'queued-1', queueId: 'q' }),
    );

    await expect(controller.result(request, metadata())).resolves.toEqual({
      success: true,
    });
  });

  // updateResult writes the payload to object storage before anything else, so
  // a storage outage surfaced here as a bare "Internal server error" with
  // nothing logged server-side. The worker could not tell an infrastructure
  // problem from a rejected result, so the job sat in_progress and was
  // re-dispatched forever — a scan that silently re-ran every two minutes while
  // the API still reported healthy.
  it('answers an intake failure with a retryable status rather than an opaque error', async () => {
    const controller = buildController(
      jest
        .fn()
        .mockRejectedValue(
          new Error('Failed to save file: The specified bucket does not exist'),
        ),
    );

    const error = await controller
      .result(request, metadata())
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(RpcException);
    // UNAVAILABLE marks this retryable, and the message names the real cause
    // rather than the previous opaque "Internal server error".
    expect((error as RpcException).getError()).toMatchObject({
      code: GrpcStatus.UNAVAILABLE,
      message: expect.stringContaining('bucket does not exist') as unknown,
    });
  });

  it('logs the underlying cause instead of discarding it', async () => {
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const controller = buildController(
      jest.fn().mockRejectedValue(new Error('NoSuchBucket')),
    );

    await controller.result(request, metadata()).catch(() => undefined);

    // Silence here is what made this take a log-archaeology session to diagnose.
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('NoSuchBucket'),
      expect.anything(),
    );
  });
});
