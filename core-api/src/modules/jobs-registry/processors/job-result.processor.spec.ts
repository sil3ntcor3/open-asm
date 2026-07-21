import { JobStatus, ToolCategory, WorkerType } from '@/common/enums/enum';
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
        stderr:
          '[FTL] Could not run enumeration: no valid ipv4 or ipv6 targets were found',
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
      'scanner exited with code 1: [FTL] Could not run enumeration: no valid ipv4 or ipv6 targets were found',
    );
    expect(dataAdapterService.syncData).not.toHaveBeenCalled();
    expect(jobsRegistryService.handleJobError).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: storedJob.id,
        data: expect.objectContaining({
          failureMessage: 'scanner exited with code 1',
          stderr: expect.stringContaining('no valid ipv4 or ipv6 targets'),
        }),
      }),
      storedJob,
      expect.any(Error),
    );
  });

  it('treats a screenshot capture failure as a completed best-effort step', async () => {
    // A screenshot is best-effort enrichment: failing to capture one (e.g. the
    // target is a non-web service such as SMTP:465) must not fail the job or the
    // run. The step is completed with no data and the pipeline still advances to
    // the next tool (e.g. nuclei) instead of stalling and reporting "failed".
    const storedJob = {
      id: '9d3f0c6a-1b2c-4d5e-8f90-abcdef012345',
      isSaveData: true,
      isPublishEvent: false,
      tool: {
        type: WorkerType.BUILT_IN,
        name: 'screenshot',
        category: ToolCategory.SCREENSHOT,
      },
      assetService: { value: 'frazerlanier.com:465' },
      jobHistory: { id: '32193967-812b-436f-8b4e-961d11f43b7b' },
      status: JobStatus.IN_PROGRESS,
    } as unknown as Job;

    const jobsRegistryService = {
      findJobForUpdate: jest.fn().mockResolvedValue(storedJob),
      handleJobError: jest.fn().mockResolvedValue(undefined),
      getNextStepForJob: jest.fn().mockResolvedValue(1),
      markWorkflowDone: jest.fn().mockResolvedValue(undefined),
    } as unknown as JobsRegistryService;
    const dataAdapterService = {
      syncData: jest.fn(),
    } as unknown as DataAdapterService;
    const storageService = {
      readJsonFile: jest.fn().mockResolvedValue({
        error: true,
        outcome: 'failed',
        failureMessage: 'failed to load page https://frazerlanier.com:465',
      }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    } as unknown as StorageService;
    const jobRepo = {
      save: jest.fn().mockResolvedValue(storedJob),
    } as unknown as Repository<Job>;

    const processor = new JobResultProcessor(
      jobsRegistryService,
      dataAdapterService,
      {} as RedisService,
      storageService,
      jobRepo,
    );
    const bullJob = {
      data: {
        workerId: 'worker-1',
        jobId: storedJob.id,
        resultRef: 'job-results/result.json',
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as BullJob<{
      workerId: string;
      jobId: string;
      resultRef: string;
    }>;

    await expect(processor.process(bullJob)).resolves.toBeUndefined();

    // Not treated as a failure...
    expect(jobsRegistryService.handleJobError).not.toHaveBeenCalled();
    expect(dataAdapterService.syncData).not.toHaveBeenCalled();
    // ...marked completed and the pipeline advanced.
    expect(jobRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: JobStatus.COMPLETED }),
    );
    expect(jobsRegistryService.getNextStepForJob).toHaveBeenCalled();
  });
});
