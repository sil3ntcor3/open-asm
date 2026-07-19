import { JobStatus, WorkerType } from '@/common/enums/enum';
import type { DataAdapterService } from '@/modules/data-adapter/data-adapter.service';
import type { StorageService } from '@/modules/storage/storage.service';
import type { RedisService } from '@/services/redis/redis.service';
import type { Job as BullJob } from 'bullmq';
import type { Repository } from 'typeorm';
import type { Job } from '../entities/job.entity';
import type { JobsRegistryService } from '../jobs-registry.service';
import { JobResultProcessor } from './job-result.processor';

describe('JobResultProcessor', () => {
  it('rejects an error envelope before parsing or synchronizing data', async () => {
    const storedJob = {
      id: 'f23d232b-cb67-45a5-a1d4-4f6665e87792',
      isSaveData: true,
      tool: {
        type: WorkerType.BUILT_IN,
        name: 'subfinder',
      },
      jobHistory: { id: '32193967-812b-436f-8b4e-961d11f43b7b' },
      status: JobStatus.IN_PROGRESS,
    } as Job;

    const jobsRegistryService = {
      findJobForUpdate: jest.fn().mockResolvedValue(storedJob),
      handleJobError: jest.fn().mockResolvedValue(undefined),
    } as unknown as JobsRegistryService;
    const dataAdapterService = {
      syncData: jest.fn(),
    } as unknown as DataAdapterService;
    const storageService = {
      readJsonFile: jest.fn().mockResolvedValue({
        error: true,
        outcome: 'failed',
        failureMessage: 'scanner exited with code 1',
        raw: '{"host":"must-not-be-persisted.example"}',
      }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    } as unknown as StorageService;

    const processor = new JobResultProcessor(
      jobsRegistryService,
      dataAdapterService,
      {} as RedisService,
      storageService,
      { save: jest.fn() } as unknown as Repository<Job>,
    );
    const bullJob = {
      data: {
        workerId: 'worker-1',
        jobId: storedJob.id,
        resultRef: 'job-results/result.json',
      },
      attemptsMade: 0,
      opts: { attempts: 1 },
    } as BullJob<{
      workerId: string;
      jobId: string;
      resultRef: string;
    }>;

    await expect(processor.process(bullJob)).rejects.toThrow(
      'scanner exited with code 1',
    );
    expect(dataAdapterService.syncData).not.toHaveBeenCalled();
    expect(jobsRegistryService.handleJobError).toHaveBeenCalledTimes(1);
  });
});
