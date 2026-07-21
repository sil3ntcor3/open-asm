import { BullMQName, JobStatus, ToolCategory } from '@/common/enums/enum';
import { SortOrder } from '@/common/dtos/get-many-base.dto';
import { RedisService } from '@/services/redis/redis.service';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DataAdapterService } from '../data-adapter/data-adapter.service';
import { StorageService } from '../storage/storage.service';
import { ToolsService } from '../tools/tools.service';
import { JobErrorLog } from './entities/job-error-log.entity';
import { JobHistory } from './entities/job-history.entity';
import { Job } from './entities/job.entity';
import { JobControlAction } from './dto/jobs-registry.dto';
import {
  createToolExecutionPlan,
  deriveJobHistoryStatus,
  JobsRegistryService,
} from './jobs-registry.service';

describe('JobsRegistryService', () => {
  let service: JobsRegistryService;

  const mockJobRepository = {
    createQueryBuilder: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    count: jest.fn(),
    exists: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
  };

  const mockJobHistoryRepository = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  const mockJobErrorLogRepository = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockDataSource = {
    createQueryRunner: jest.fn(),
    getRepository: jest.fn(),
  };

  const mockDataAdapterService = {
    syncData: jest.fn(),
  };

  const mockStorageService = {
    upload: jest.fn(),
  };

  const mockRedisService = {
    publish: jest.fn(),
    client: {
      incr: jest.fn(),
      decr: jest.fn(),
      del: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
    },
  };

  const mockToolsService = {
    getInstalledTools: jest.fn(),
    getToolByNames: jest.fn(),
  };

  beforeEach(async () => {
    mockJobRepository.createQueryBuilder.mockReset().mockReturnThis();
    mockJobRepository.innerJoin.mockReset().mockReturnThis();
    mockJobRepository.where.mockReset().mockReturnThis();
    mockJobRepository.andWhere.mockReset().mockReturnThis();
    mockJobRepository.getOne.mockReset();
    mockJobRepository.findOne.mockReset();
    mockJobRepository.save.mockReset();
    mockJobRepository.count.mockReset();
    mockJobRepository.exists.mockReset();
    mockJobRepository.find.mockReset();
    mockJobRepository.update.mockReset();
    mockJobHistoryRepository.createQueryBuilder.mockReset();
    mockJobHistoryRepository.findOne.mockReset();
    mockJobHistoryRepository.update.mockReset();
    mockJobErrorLogRepository.createQueryBuilder.mockReset();
    mockJobErrorLogRepository.findOne.mockReset();
    mockJobErrorLogRepository.save.mockReset();
    mockDataSource.createQueryRunner.mockReset();
    mockDataSource.getRepository.mockReset();
    mockDataAdapterService.syncData.mockReset();
    mockStorageService.upload.mockReset();
    mockRedisService.publish.mockReset();
    mockRedisService.client.incr.mockReset();
    mockRedisService.client.decr.mockReset();
    mockRedisService.client.del.mockReset();
    mockRedisService.client.get.mockReset();
    mockRedisService.client.set.mockReset();
    mockToolsService.getInstalledTools.mockReset();
    mockToolsService.getToolByNames.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: getRepositoryToken(Job),
          useValue: mockJobRepository,
        },
        {
          provide: getRepositoryToken(JobHistory),
          useValue: mockJobHistoryRepository,
        },
        {
          provide: getRepositoryToken(JobErrorLog),
          useValue: mockJobErrorLogRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: DataAdapterService,
          useValue: mockDataAdapterService,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: ToolsService,
          useValue: mockToolsService,
        },
        {
          provide: getQueueToken(BullMQName.JOB_RESULT),
          useValue: { add: jest.fn() },
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
        JobsRegistryService,
      ],
    }).compile();

    service = module.get<JobsRegistryService>(JobsRegistryService);
    // Manually set optional toolsService since @Optional() dependencies may not be injected in tests
    (service as any).toolsService = mockToolsService;
  });

  const mockHistoryWorkspaceCheck = (exists = true) => {
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(exists),
    };
    mockJobHistoryRepository.createQueryBuilder.mockReturnValue(qb);
    return qb;
  };

  describe('typed worker execution plan', () => {
    it('keeps a hostile-looking target as data instead of interpolating a command', () => {
      const target = 'https://example.com/?x=1;touch /tmp/pwn&y=$(id)';
      const plan = createToolExecutionPlan({
        tool: { name: 'nuclei' },
        asset: { value: target },
      } as Job);

      expect(plan).toEqual({
        toolName: 'nuclei',
        target,
        port: undefined,
      });
    });

    it('refuses tools outside the built-in worker allowlist', () => {
      const plan = createToolExecutionPlan({
        tool: { name: 'custom-shell' },
        asset: { value: 'example.com' },
      } as Job);

      expect(plan).toBeNull();
    });
  });

  describe('scanner eligibility', () => {
    it('excludes explicitly unresolved assets from port scanning', async () => {
      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockDataSource.getRepository.mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      });

      await (
        service as unknown as {
          findAssetsForJob(
            targetIds?: string[],
            assetIds?: string[],
            workspaceId?: string,
            category?: ToolCategory,
          ): Promise<unknown[]>;
        }
      ).findAssetsForJob(undefined, undefined, undefined, ToolCategory.PORTS_SCANNER);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'assets.dnsResolutionStatus != :unresolvedDnsStatus',
        { unresolvedDnsStatus: 'unresolved' },
      );
    });

    const makeAssetServiceQb = () => {
      const qb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockDataSource.getRepository.mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      });
      return qb;
    };

    const findAssetServices = (category: ToolCategory) =>
      (
        service as unknown as {
          findAssetServicesForJob(
            targetIds?: string[],
            assetIds?: string[],
            workspaceId?: string,
            category?: ToolCategory,
          ): Promise<unknown[]>;
        }
      ).findAssetServicesForJob(undefined, undefined, undefined, category);

    // Screenshots only run against endpoints nmap identified as web (scheme set).
    // This is the reliable, port-agnostic "web service" gate that replaces the
    // fragile httpx signal.
    it('gates screenshot creation on the nmap web scheme', async () => {
      const qb = makeAssetServiceQb();
      await findAssetServices(ToolCategory.SCREENSHOT);
      expect(qb.andWhere).toHaveBeenCalledWith(
        'assetServices.scheme IS NOT NULL',
      );
    });

    it('does not scheme-gate http probe or service discovery', async () => {
      for (const category of [
        ToolCategory.HTTP_PROBE,
        ToolCategory.SERVICE_DISCOVERY,
      ]) {
        const qb = makeAssetServiceQb();
        await findAssetServices(category);
        const schemeGated = qb.andWhere.mock.calls.some(
          ([clause]) => typeof clause === 'string' && clause.includes('scheme'),
        );
        expect(schemeGated).toBe(false);
      }
    });
  });

  describe('handleJobError', () => {
    it('records a terminal completion time and bounded worker diagnostics', async () => {
      const job = {
        id: 'job-uuid',
        retryCount: 0,
        status: JobStatus.IN_PROGRESS,
      } as Job;
      mockJobRepository.save.mockResolvedValue(undefined);
      mockJobErrorLogRepository.findOne.mockResolvedValue(null);
      mockJobErrorLogRepository.save.mockResolvedValue(undefined);

      await service.handleJobError(
        {
          jobId: job.id,
          data: {
            error: true,
            payload: undefined,
            outcome: 'failed',
            exitCode: 1,
            failureMessage: 'command exited with code 1',
            stderr: '[FTL] no valid ipv4 or ipv6 targets were found',
          },
        },
        job,
        new Error(
          'command exited with code 1: [FTL] no valid ipv4 or ipv6 targets were found',
        ),
      );

      expect(mockJobRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: JobStatus.FAILED,
          completedAt: expect.any(Date),
        }),
      );
      expect(mockJobErrorLogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.stringContaining('no valid ipv4 or ipv6 targets'),
        }),
      );
    });
  });

  describe('reRunJob', () => {
    const mockWorkspaceId = 'workspace-uuid';
    const mockJobId = 'job-uuid';
    const mockJob = {
      id: mockJobId,
      status: JobStatus.COMPLETED,
      workerId: 'worker-uuid',
      retryCount: 0,
      asset: {
        target: {
          id: 'target-uuid',
        },
      },
    };

    it('should successfully re-run a job', async () => {
      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        manager: {
          save: jest.fn().mockResolvedValue({
            ...mockJob,
            status: JobStatus.PENDING,
            workerId: undefined,
            retryCount: 1,
          }),
        },
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
      };

      mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
      mockJobRepository.getOne.mockResolvedValue(mockJob);

      const result = await service.reRunJob(mockWorkspaceId, mockJobId);

      expect(mockJobRepository.createQueryBuilder).toHaveBeenCalledWith('job');
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Job re-run successfully' });

      // Verify the job was updated correctly
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith({
        ...mockJob,
        status: JobStatus.PENDING,
        workerId: null,
        pickJobAt: null,
        completedAt: null,
        retryCount: 1,
      });
    });

    it('should throw NotFoundException when job not found in workspace', async () => {
      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        manager: {
          createQueryBuilder: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(null),
        },
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
      };

      mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
      mockJobRepository.getOne.mockResolvedValue(null);

      await expect(
        service.reRunJob(mockWorkspaceId, mockJobId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.reRunJob(mockWorkspaceId, mockJobId),
      ).rejects.toThrow('Job not found in workspace');

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should rollback transaction when error occurs', async () => {
      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        manager: {
          save: jest.fn(),
        },
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
      };

      mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
      mockJobRepository.getOne.mockRejectedValue(new Error('Database error'));

      await expect(
        service.reRunJob(mockWorkspaceId, mockJobId),
      ).rejects.toThrow('Database error');
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('cancelJob', () => {
    const mockWorkspaceId = 'workspace-uuid';
    const mockJobId = 'job-uuid';
    const mockJob = {
      id: mockJobId,
      status: JobStatus.IN_PROGRESS,
      workerId: 'worker-uuid',
      retryCount: 0,
      asset: {
        target: {
          id: 'target-uuid',
        },
      },
    };

    it('should successfully cancel a job', async () => {
      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        manager: {
          save: jest.fn().mockResolvedValue({
            ...mockJob,
            status: JobStatus.CANCELLED,
          }),
        },
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
      };

      mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
      mockJobRepository.getOne.mockResolvedValue(mockJob);

      const result = await service.cancelJob(mockWorkspaceId, mockJobId);

      expect(mockJobRepository.createQueryBuilder).toHaveBeenCalledWith('job');
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Job cancelled successfully' });

      // Verify the job status was updated to cancelled
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith({
        ...mockJob,
        status: JobStatus.CANCELLED,
      });
    });

    it('should throw NotFoundException when job not found in workspace', async () => {
      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        manager: {
          createQueryBuilder: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(null),
        },
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
      };

      mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
      mockJobRepository.getOne.mockResolvedValue(null);

      await expect(
        service.cancelJob(mockWorkspaceId, mockJobId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.cancelJob(mockWorkspaceId, mockJobId),
      ).rejects.toThrow('Job not found in workspace');

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should rollback transaction when error occurs', async () => {
      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        manager: {
          createQueryBuilder: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockRejectedValue(new Error('Database error')),
        },
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
      };

      mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
      mockJobRepository.getOne.mockRejectedValue(new Error('Database error'));

      await expect(
        service.cancelJob(mockWorkspaceId, mockJobId),
      ).rejects.toThrow('Database error');
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('resumeJob', () => {
    const mockWorkspaceId = 'workspace-uuid';
    const mockJobId = 'job-uuid';

    it('requeues a paused in-progress job instead of resuming a local process', async () => {
      const verifyQb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: mockJobId,
          status: JobStatus.PAUSED,
          workerId: 'worker-uuid',
        }),
      };
      const updateQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      mockJobRepository.createQueryBuilder
        .mockReturnValueOnce(verifyQb)
        .mockReturnValueOnce(updateQb);

      const result = await service.resumeJob(mockWorkspaceId, mockJobId);

      expect(updateQb.set).toHaveBeenCalledWith({
        status: JobStatus.PENDING,
        workerId: expect.any(Function),
      });
      expect(updateQb.where).toHaveBeenCalledWith('id = :id', {
        id: mockJobId,
      });
      expect(result).toEqual({ message: 'Job requeued successfully' });
    });
  });

  describe('job history batch actions', () => {
    const mockWorkspaceId = 'workspace-uuid';
    const mockHistoryId = 'history-uuid';

    it('pauses only pending and in-progress jobs in a job history', async () => {
      mockHistoryWorkspaceCheck();
      const updateQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      };
      mockJobRepository.createQueryBuilder.mockReturnValue(updateQb);

      const result = await service.pauseJobHistoryJobs(
        mockWorkspaceId,
        mockHistoryId,
      );

      expect(updateQb.set).toHaveBeenCalledWith({
        status: JobStatus.PAUSED,
      });
      expect(updateQb.where).toHaveBeenCalledWith(
        '"jobHistoryId" = :jobHistoryId',
        { jobHistoryId: mockHistoryId },
      );
      expect(updateQb.andWhere).toHaveBeenCalledWith(
        'status IN (:...statuses)',
        {
          statuses: [JobStatus.PENDING, JobStatus.IN_PROGRESS],
        },
      );
      expect(result).toEqual({ message: '2 job(s) paused successfully' });
    });

    it('resumes only paused jobs in a job history and clears worker claims', async () => {
      mockHistoryWorkspaceCheck();
      const updateQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockJobRepository.createQueryBuilder.mockReturnValue(updateQb);

      const result = await service.resumeJobHistoryJobs(
        mockWorkspaceId,
        mockHistoryId,
      );

      expect(updateQb.set).toHaveBeenCalledWith({
        status: JobStatus.PENDING,
        workerId: expect.any(Function),
      });
      expect(updateQb.where).toHaveBeenCalledWith(
        '"jobHistoryId" = :jobHistoryId',
        { jobHistoryId: mockHistoryId },
      );
      expect(updateQb.andWhere).toHaveBeenCalledWith('status = :status', {
        status: JobStatus.PAUSED,
      });
      expect(result).toEqual({ message: '1 job(s) resumed successfully' });
    });

    it('cancels only pending, in-progress, and paused jobs in a job history', async () => {
      mockHistoryWorkspaceCheck();
      const updateQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 3 }),
      };
      mockJobRepository.createQueryBuilder.mockReturnValue(updateQb);

      const result = await service.cancelJobHistoryJobs(
        mockWorkspaceId,
        mockHistoryId,
      );

      expect(updateQb.set).toHaveBeenCalledWith({
        status: JobStatus.CANCELLED,
        completedAt: expect.any(Function),
      });
      expect(updateQb.where).toHaveBeenCalledWith(
        '"jobHistoryId" = :jobHistoryId',
        { jobHistoryId: mockHistoryId },
      );
      expect(updateQb.andWhere).toHaveBeenCalledWith(
        'status IN (:...statuses)',
        {
          statuses: [
            JobStatus.PENDING,
            JobStatus.IN_PROGRESS,
            JobStatus.PAUSED,
          ],
        },
      );
      expect(result).toEqual({ message: '3 job(s) cancelled successfully' });
    });

    it('deletes every job row in a job history', async () => {
      mockHistoryWorkspaceCheck();
      const deleteQb = {
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 4 }),
      };
      mockJobRepository.createQueryBuilder.mockReturnValue(deleteQb);

      const result = await service.deleteJobHistoryJobs(
        mockWorkspaceId,
        mockHistoryId,
      );

      expect(deleteQb.delete).toHaveBeenCalled();
      expect(deleteQb.from).toHaveBeenCalledWith(Job);
      expect(deleteQb.where).toHaveBeenCalledWith(
        '"jobHistoryId" = :jobHistoryId',
        { jobHistoryId: mockHistoryId },
      );
      expect(result).toEqual({ message: '4 job(s) deleted successfully' });
    });

    it('throws NotFoundException when a job history is outside the workspace', async () => {
      mockHistoryWorkspaceCheck(false);

      await expect(
        service.pauseJobHistoryJobs(mockWorkspaceId, mockHistoryId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteJob', () => {
    const mockWorkspaceId = 'workspace-uuid';
    const mockJobId = 'job-uuid';
    const mockJob = {
      id: mockJobId,
      status: JobStatus.COMPLETED,
      workerId: 'worker-uuid',
      retryCount: 0,
      asset: {
        target: {
          id: 'target-uuid',
        },
      },
    };

    it('should successfully delete a job', async () => {
      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        manager: {
          remove: jest.fn().mockResolvedValue(mockJob),
        },
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
      };

      mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
      mockJobRepository.getOne.mockResolvedValue(mockJob);

      const result = await service.deleteJob(mockWorkspaceId, mockJobId);

      expect(mockJobRepository.createQueryBuilder).toHaveBeenCalledWith('job');
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Job deleted successfully' });

      // Verify the job was removed
      expect(mockQueryRunner.manager.remove).toHaveBeenCalledWith(mockJob);
    });

    it('should throw NotFoundException when job not found in workspace', async () => {
      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        manager: {
          createQueryBuilder: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(null),
        },
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
      };

      mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
      mockJobRepository.getOne.mockResolvedValue(null);

      await expect(
        service.deleteJob(mockWorkspaceId, mockJobId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.deleteJob(mockWorkspaceId, mockJobId),
      ).rejects.toThrow('Job not found in workspace');

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should rollback transaction when error occurs', async () => {
      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        manager: {
          createQueryBuilder: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockRejectedValue(new Error('Database error')),
        },
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
      };

      mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
      mockJobRepository.getOne.mockRejectedValue(new Error('Database error'));

      await expect(
        service.deleteJob(mockWorkspaceId, mockJobId),
      ).rejects.toThrow('Database error');
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('getJobHistoryDetail', () => {
    const mockWorkspaceId = 'workspace-uuid';
    const mockHistoryId = 'history-uuid';
    const mockJobs = [
      {
        id: 'job-1',
        status: JobStatus.COMPLETED,
        tool: { name: 'test-tool' },
      },
    ];
    const mockJobHistory = {
      id: mockHistoryId,
      createdAt: new Date(),
      updatedAt: new Date(),
      jobs: mockJobs,
      workflow: {
        name: 'test-workflow',
        content: {
          jobs: [{ run: 'test-tool' }],
        },
      },
      jobHistoryName: 'test-job-history',
    };

    it('should return job history detail with jobs', async () => {
      mockJobHistoryRepository.findOne.mockResolvedValue(mockJobHistory);
      mockJobHistoryRepository.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getExists: jest.fn().mockResolvedValue(true),
      });
      mockToolsService.getInstalledTools.mockResolvedValue({
        data: [{ name: 'test-tool' }],
      });

      const result = await service.getJobHistoryDetail(
        mockWorkspaceId,
        mockHistoryId,
      );

      expect(mockJobHistoryRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockHistoryId },
        relations: {
          workflow: true,
          jobs: {
            tool: true,
          },
        },
      });
      expect(result).toEqual({
        id: mockHistoryId,
        workflowName: 'test-workflow',
        jobHistoryName: 'test-job-history',
        createdAt: mockJobHistory.createdAt,
        updatedAt: mockJobHistory.updatedAt,
        tools: [{ name: 'test-tool' }],
      });
    });

    it('should throw NotFoundException when job history not found', async () => {
      mockJobHistoryRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getJobHistoryDetail(mockWorkspaceId, mockHistoryId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when job history not in workspace', async () => {
      mockJobHistoryRepository.findOne.mockResolvedValue(mockJobHistory);
      mockJobHistoryRepository.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getExists: jest.fn().mockResolvedValue(false),
      });

      await expect(
        service.getJobHistoryDetail(mockWorkspaceId, mockHistoryId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getManyJobHistories', () => {
    const mockWorkspaceId = 'workspace-uuid';

    type JobHistoryQueryBuilderMock = {
      selectedFields: string[];
      innerJoin: jest.Mock<JobHistoryQueryBuilderMock, []>;
      leftJoin: jest.Mock<JobHistoryQueryBuilderMock, []>;
      where: jest.Mock<JobHistoryQueryBuilderMock, []>;
      select: jest.Mock<JobHistoryQueryBuilderMock, [string[]]>;
      groupBy: jest.Mock<JobHistoryQueryBuilderMock, []>;
      addGroupBy: jest.Mock<JobHistoryQueryBuilderMock, []>;
      orderBy: jest.Mock<JobHistoryQueryBuilderMock, []>;
      offset: jest.Mock<JobHistoryQueryBuilderMock, []>;
      limit: jest.Mock<JobHistoryQueryBuilderMock, []>;
      getRawMany: jest.Mock<Promise<unknown[]>, []>;
    };

    const createJobHistoryQueryBuilder = (): JobHistoryQueryBuilderMock => {
      const selectedFields: string[] = [];
      const qb = {} as JobHistoryQueryBuilderMock;

      Object.assign(qb, {
        selectedFields,
        innerJoin: jest.fn((): JobHistoryQueryBuilderMock => qb),
        leftJoin: jest.fn((): JobHistoryQueryBuilderMock => qb),
        where: jest.fn((): JobHistoryQueryBuilderMock => qb),
        select: jest.fn((fields: string[]): JobHistoryQueryBuilderMock => {
          selectedFields.push(...fields);
          return qb;
        }),
        groupBy: jest.fn((): JobHistoryQueryBuilderMock => qb),
        addGroupBy: jest.fn((): JobHistoryQueryBuilderMock => qb),
        orderBy: jest.fn((): JobHistoryQueryBuilderMock => qb),
        offset: jest.fn((): JobHistoryQueryBuilderMock => qb),
        limit: jest.fn((): JobHistoryQueryBuilderMock => qb),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      return qb;
    };

    it('selects the per-status counts needed to derive the aggregate status in TS', async () => {
      const historyQb = createJobHistoryQueryBuilder();
      const countQb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      };
      mockJobHistoryRepository.createQueryBuilder
        .mockReturnValueOnce(historyQb)
        .mockReturnValueOnce(countQb);

      await service.getManyJobHistories(mockWorkspaceId, {
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: SortOrder.DESC,
      });

      // Every job status must be counted so deriveJobHistoryStatus can decide
      // whether the run is still active before calling it terminal.
      for (const status of [
        JobStatus.PENDING,
        JobStatus.IN_PROGRESS,
        JobStatus.PAUSED,
        JobStatus.COMPLETED,
        JobStatus.FAILED,
        JobStatus.CANCELLED,
      ]) {
        const selection = historyQb.selectedFields.find((field) =>
          field.includes(`AND status = '${status}'`),
        );
        expect(selection).toBeDefined();
      }

      // The aggregate status is no longer computed in SQL.
      const statusSelection = historyQb.selectedFields.find((field) =>
        field.includes(') as "status"'),
      );
      expect(statusSelection).toBeUndefined();

      const endedAtSelection = historyQb.selectedFields.find((field) =>
        field.includes(') as "updatedAt"'),
      );
      expect(endedAtSelection).toContain(
        'MAX(COALESCE("completedAt", "updatedAt"))',
      );
    });
  });

  describe('deriveJobHistoryStatus', () => {
    const counts = (overrides: Partial<Parameters<typeof deriveJobHistoryStatus>[0]>) => {
      const base = {
        total: 0,
        pending: 0,
        inProgress: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      };
      const merged = { ...base, ...overrides };
      merged.total =
        overrides.total ??
        merged.pending +
          merged.inProgress +
          merged.paused +
          merged.completed +
          merged.failed +
          merged.cancelled;
      return merged;
    };

    it('reports IN_PROGRESS while jobs are still running even if some have already failed (the frazerlanier.com regression)', () => {
      // 19 completed + 4 in_progress + 6 failed => run is NOT finished.
      expect(
        deriveJobHistoryStatus(
          counts({ completed: 19, inProgress: 4, failed: 6 }),
        ),
      ).toBe(JobStatus.IN_PROGRESS);
    });

    it('keeps a history active while pending work remains alongside failures', () => {
      expect(
        deriveJobHistoryStatus(counts({ completed: 2, failed: 1, pending: 3 })),
      ).toBe(JobStatus.IN_PROGRESS);
    });

    it('reports PENDING when nothing has started yet', () => {
      expect(deriveJobHistoryStatus(counts({ pending: 5 }))).toBe(
        JobStatus.PENDING,
      );
    });

    it('does not report FAILED when some jobs completed, even once every job is terminal', () => {
      // The whole run must not be branded failed just because individual tasks
      // failed. As long as at least one job produced a result, the run is
      // COMPLETED; the per-status counts still expose the failures on drill-down.
      expect(
        deriveJobHistoryStatus(counts({ completed: 20, failed: 6 })),
      ).toBe(JobStatus.COMPLETED);
    });

    it('reports COMPLETED for a terminal mix of completed, failed and cancelled', () => {
      expect(
        deriveJobHistoryStatus(counts({ completed: 19, failed: 6, cancelled: 2 })),
      ).toBe(JobStatus.COMPLETED);
    });

    it('reports FAILED only when every terminal job failed (no successes)', () => {
      expect(deriveJobHistoryStatus(counts({ failed: 5 }))).toBe(
        JobStatus.FAILED,
      );
    });

    it('reports FAILED for failures mixed with cancellations but no successes', () => {
      expect(
        deriveJobHistoryStatus(counts({ failed: 3, cancelled: 2 })),
      ).toBe(JobStatus.FAILED);
    });

    it('reports COMPLETED when every job succeeded', () => {
      expect(deriveJobHistoryStatus(counts({ completed: 10 }))).toBe(
        JobStatus.COMPLETED,
      );
    });

    it('treats completed + cancelled (no failures) as COMPLETED', () => {
      expect(
        deriveJobHistoryStatus(counts({ completed: 8, cancelled: 2 })),
      ).toBe(JobStatus.COMPLETED);
    });

    it('reports CANCELLED when every job was cancelled', () => {
      expect(deriveJobHistoryStatus(counts({ cancelled: 5 }))).toBe(
        JobStatus.CANCELLED,
      );
    });

    it('reports PAUSED when work is held and nothing is actively running', () => {
      expect(
        deriveJobHistoryStatus(counts({ completed: 3, paused: 2 })),
      ).toBe(JobStatus.PAUSED);
    });

    it('prefers the active IN_PROGRESS state over a held PAUSED job', () => {
      expect(
        deriveJobHistoryStatus(counts({ inProgress: 1, paused: 2 })),
      ).toBe(JobStatus.IN_PROGRESS);
    });

    it('defends against an empty history', () => {
      expect(deriveJobHistoryStatus(counts({}))).toBe(JobStatus.PENDING);
    });
  });

  describe('getNextStepForJob', () => {
    const mockJob = {
      id: 'job-uuid',
      tool: { name: 'tool-a' },
      asset: {
        id: 'asset-uuid-for-mockjob',
        target: { id: 'target-uuid' },
      },
      jobHistory: {
        workflow: {
          content: {
            jobs: [
              { name: 'job-1', run: 'tool-a' },
              { name: 'job-2', run: 'tool-b' },
            ],
          },
          workspace: { id: 'workspace-uuid' },
        },
      },
    };

    it('should return 0 when no workflow exists', async () => {
      const jobNoWorkflow = { ...mockJob, jobHistory: { workflow: null } };

      const result = await service.getNextStepForJob(jobNoWorkflow as any);

      expect(result).toBe(0);
    });

    it('should return 0 when current tool not found in workflow', async () => {
      const jobNoTool = {
        ...mockJob,
        tool: { name: 'unknown-tool' },
      };

      const result = await service.getNextStepForJob(jobNoTool as any);

      expect(result).toBe(0);
    });

    it('should return 0 when current tool is last in workflow', async () => {
      const lastToolJob = {
        ...mockJob,
        tool: { name: 'tool-b' },
      };

      const result = await service.getNextStepForJob(lastToolJob as any);

      expect(result).toBe(0);
    });

    it('should return number of new jobs created when next step exists', async () => {
      const jobWithNextStep = {
        id: 'job-uuid',
        tool: { name: 'tool-a' },
        asset: {
          target: { id: 'target-uuid' },
        },
        jobHistory: {
          workflow: {
            content: {
              jobs: [
                { name: 'job-1', run: 'tool-a' },
                { name: 'job-2', run: 'tool-b' },
              ],
            },
            workspace: { id: undefined },
          },
        },
      };

      mockToolsService.getToolByNames.mockResolvedValue([
        { name: 'tool-b', priority: 4, category: 'SUBDOMAINS' },
      ]);

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest
          .fn()
          .mockResolvedValue([{ id: 'asset-1', isPrimary: true }]),
      };
      const mockJobRepo = {
        create: jest.fn().mockReturnValue({}),
        save: jest.fn().mockResolvedValue([{}]),
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      };
      mockDataSource.getRepository.mockReturnValue(mockJobRepo);

      const result = await service.getNextStepForJob(jobWithNextStep as any);

      expect(result).toBe(1);
    });

    it('scopes a non-target-wide next step to the triggering asset', async () => {
      mockToolsService.getToolByNames.mockResolvedValue([
        { name: 'tool-b', priority: 4, category: 'http_probe' },
      ]);
      const createSpy = jest
        .spyOn(service, 'createNewJob')
        .mockResolvedValue([{} as any]);

      await service.getNextStepForJob(mockJob as any);

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ assetIds: ['asset-uuid-for-mockjob'] }),
      );
      createSpy.mockRestore();
    });

    it('fans a VULNERABILITIES next step out across all enabled target assets', async () => {
      mockToolsService.getToolByNames.mockResolvedValue([
        { name: 'nuclei', priority: 4, category: 'vulnerabilities' },
      ]);
      const createSpy = jest
        .spyOn(service, 'createNewJob')
        .mockResolvedValue([{} as any]);

      await service.getNextStepForJob(mockJob as any);

      // Empty assetIds makes createNewJob query every enabled asset for the
      // target instead of only the asset whose chain reached this step.
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          assetIds: [],
          targetIds: ['target-uuid'],
        }),
      );
      createSpy.mockRestore();
    });
  });

  describe('getWorkerControl', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-04T23:21:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('pauses an active in-progress job when its target scan window is closed', async () => {
      const workerId = 'worker-uuid';
      const jobId = 'job-uuid';
      const updateQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      mockDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          id: workerId,
          maxConcurrency: 1,
          isPaused: false,
        }),
      });
      mockJobRepository.find.mockResolvedValue([
        {
          id: jobId,
          status: JobStatus.IN_PROGRESS,
          asset: {
            target: {
              scanWindowStart: '23:15',
              scanWindowEnd: '23:20',
              scanWindowTimezone: 'UTC',
              scanWindowDays: [6],
            },
          },
        },
      ]);
      mockJobRepository.createQueryBuilder.mockReturnValue(updateQb);

      const result = await service.getWorkerControl(workerId, [jobId]);

      expect(result.directives).toEqual([
        { jobId, action: JobControlAction.PAUSE },
      ]);
      expect(mockJobRepository.update).toHaveBeenCalledWith(jobId, {
        status: JobStatus.PAUSED,
      });
    });

    it('resumes an active in-progress job while its target scan window is open', async () => {
      jest.setSystemTime(new Date('2026-07-04T23:16:00.000Z'));
      const workerId = 'worker-uuid';
      const jobId = 'job-uuid';
      const updateQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      mockDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          id: workerId,
          maxConcurrency: 1,
          isPaused: false,
        }),
      });
      mockJobRepository.find.mockResolvedValue([
        {
          id: jobId,
          status: JobStatus.IN_PROGRESS,
          asset: {
            target: {
              scanWindowStart: '23:15',
              scanWindowEnd: '23:20',
              scanWindowTimezone: 'UTC',
              scanWindowDays: [6],
            },
          },
        },
      ]);
      mockJobRepository.createQueryBuilder.mockReturnValue(updateQb);

      const result = await service.getWorkerControl(workerId, [jobId]);

      expect(result.directives).toEqual([
        { jobId, action: JobControlAction.RESUME },
      ]);
    });
  });

  describe('markWorkflowDone', () => {
    const mockJobHistoryId = 'history-uuid';

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should update job history isCompleted to true', async () => {
      mockJobRepository.exists.mockResolvedValue(false);
      mockJobHistoryRepository.update.mockResolvedValue({ affected: 1 });
      mockJobHistoryRepository.findOne.mockResolvedValue({
        id: mockJobHistoryId,
        workflow: { name: 'test-workflow' },
      });

      await service.markWorkflowDone(mockJobHistoryId);

      expect(mockJobRepository.exists).toHaveBeenCalled();
      expect(mockJobHistoryRepository.update).toHaveBeenCalledWith(
        { id: mockJobHistoryId, isCompleted: false },
        { isCompleted: true },
      );
    });

    it('should not update when there are pending jobs', async () => {
      mockJobRepository.exists.mockResolvedValue(true);

      await service.markWorkflowDone(mockJobHistoryId);

      expect(mockJobHistoryRepository.update).not.toHaveBeenCalled();
    });

    it('should not update when already completed', async () => {
      mockJobRepository.exists.mockResolvedValue(false);
      mockJobHistoryRepository.update.mockResolvedValue({ affected: 0 });

      await service.markWorkflowDone(mockJobHistoryId);

      expect(mockJobHistoryRepository.update).toHaveBeenCalled();
    });
  });
});
