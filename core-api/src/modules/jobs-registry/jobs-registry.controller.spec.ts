import { WORKER_TOKEN_HEADER } from '@/common/constants/app.constants';
import type { GrpcWorkerContext } from '@/common/guards/grpc-worker-context.service';
import { Metadata } from '@grpc/grpc-js';
import type { Asset } from '../assets/entities/assets.entity';
import type { WorkerInstance } from '../workers/entities/worker.entity';
import type { GetNextJobResponseDto } from './dto/jobs-registry.dto';
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
