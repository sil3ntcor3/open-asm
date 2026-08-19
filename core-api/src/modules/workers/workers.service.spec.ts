import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ApiKeysService } from '../apikeys/apikeys.service';
import { Asset } from '../assets/entities/assets.entity';
import { JobsRegistryService } from '../jobs-registry/jobs-registry.service';
import { InternalNetwork } from '../internal-networks/entities/internal-network.entity';
import { NetworkInterface } from '../internal-networks/entities/network-interface.entity';
import { WorkspaceTool } from '../tools/entities/workspace_tools.entity';
import { ToolsService } from '../tools/tools.service';
import { RedisService } from '@/services/redis/redis.service';
import { WorkerScope, WorkerType } from '@/common/enums/enum';
import { AliveStreamManager } from './alive-stream-manager.service';
import { WorkerInstance } from './entities/worker.entity';
import { WorkersService } from './workers.service';

describe('WorkersService', () => {
  let service: WorkersService;
  let mockWorkerInstanceRepository: Partial<Repository<WorkerInstance>>;
  let mockAssetRepository: Partial<Repository<any>>;
  let mockWorkspaceToolRepository: Partial<Repository<any>>;
  let mockInternalNetworkRepository: Partial<Repository<any>>;
  let mockNetworkInterfaceRepository: Partial<Repository<any>>;
  let mockJobsRegistryService: Partial<JobsRegistryService>;
  let mockApiKeysService: Partial<ApiKeysService>;
  let mockConfigService: Partial<ConfigService>;
  let mockToolsService: Partial<ToolsService>;
  let mockRedisService: Partial<RedisService>;
  let mockAliveStreamManager: Partial<AliveStreamManager>;

  beforeEach(async () => {
    mockWorkerInstanceRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      getOneOrFail: jest.fn(),
      getMany: jest.fn(),
      getManyAndCount: jest.fn(),
      getRawMany: jest.fn(),
      getRawOne: jest.fn(),
    } as any;

    mockAssetRepository = {
      findOne: jest.fn(),
    } as any;

    mockWorkspaceToolRepository = {
      findOne: jest.fn(),
    } as any;

    mockInternalNetworkRepository = {
      findOne: jest.fn(),
    } as any;

    mockNetworkInterfaceRepository = {
      insert: jest.fn(),
    } as any;

    mockJobsRegistryService = {
      repo: {
        createQueryBuilder: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      },
    } as any;

    mockApiKeysService = {
      apiKeysRepository: {
        findOne: jest.fn(),
      },
    } as any;

    mockConfigService = {
      get: jest.fn(),
    };

    mockToolsService = {
      getBuiltInTools: jest.fn().mockResolvedValue({ data: [] }),
    };

    mockRedisService = {
      publish: jest.fn(),
    };

    mockAliveStreamManager = {
      isActive: jest.fn().mockReturnValue(false),
      register: jest.fn().mockReturnValue('stream-1'),
      unregister: jest.fn(),
      updateAlive: jest.fn(),
      getActiveWorkerIds: jest.fn().mockReturnValue(new Set()),
      getActiveStreamCount: jest.fn().mockReturnValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkersService,
        {
          provide: getRepositoryToken(WorkerInstance),
          useValue: mockWorkerInstanceRepository,
        },
        {
          provide: getRepositoryToken(Asset),
          useValue: mockAssetRepository,
        },
        {
          provide: getRepositoryToken(WorkspaceTool),
          useValue: mockWorkspaceToolRepository,
        },
        {
          provide: getRepositoryToken(InternalNetwork),
          useValue: mockInternalNetworkRepository,
        },
        {
          provide: getRepositoryToken(NetworkInterface),
          useValue: mockNetworkInterfaceRepository,
        },
        {
          provide: JobsRegistryService,
          useValue: mockJobsRegistryService,
        },
        {
          provide: ApiKeysService,
          useValue: mockApiKeysService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: ToolsService,
          useValue: mockToolsService,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: AliveStreamManager,
          useValue: mockAliveStreamManager,
        },
      ],
    }).compile();

    service = module.get<WorkersService>(WorkersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('clears the terminal timestamp when a failed job is reset for retry', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    (mockWorkerInstanceRepository.manager as any) = { query };

    await (
      service as unknown as { resetStuckAndFailedJobs(): Promise<void> }
    ).resetStuckAndFailedJobs();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('"completedAt" = CASE'),
    );
  });

  describe('getNucleiTemplateVersions', () => {
    it('returns unique sorted versions reported by workspace and cloud workers', async () => {
      (mockWorkerInstanceRepository.find as jest.Mock).mockResolvedValue([
        { nucleiTemplateVersion: 'v10.4.7' },
        { nucleiTemplateVersion: null },
        { nucleiTemplateVersion: 'v10.4.6' },
        { nucleiTemplateVersion: 'v10.4.7' },
      ]);

      const getVersions = (
        service as unknown as {
          getNucleiTemplateVersions(workspaceId: string): Promise<string[]>;
        }
      ).getNucleiTemplateVersions.bind(service);

      await expect(getVersions('workspace-1')).resolves.toEqual([
        'v10.4.6',
        'v10.4.7',
      ]);
      expect(mockWorkerInstanceRepository.find).toHaveBeenCalledWith({
        select: { nucleiTemplateVersion: true },
        where: [
          {
            type: WorkerType.BUILT_IN,
            scope: WorkerScope.WORKSPACE,
            workspaceId: 'workspace-1',
          },
          { type: WorkerType.BUILT_IN, scope: WorkerScope.CLOUD },
        ],
      });
    });
  });

  describe('autoCleanupWorkersAndJobs', () => {
    it('should delete stale workers without active streams', async () => {
      const staleWorker = {
        id: 'worker-1',
        lastSeenAt: new Date(Date.now() - 120000),
      } as WorkerInstance;

      (mockWorkerInstanceRepository.find as jest.Mock).mockResolvedValue([
        staleWorker,
      ]);
      (mockAliveStreamManager.isActive as jest.Mock).mockReturnValue(false);

      // Mock workerLeave dependencies
      (mockJobsRegistryService.repo as any).execute = jest.fn();
      (mockWorkerInstanceRepository.delete as jest.Mock).mockResolvedValue(
        undefined,
      );
      // Mock resetStuckAndFailedJobs
      (mockWorkerInstanceRepository.manager as any) = {
        query: jest.fn().mockResolvedValue(undefined),
      };

      await service.autoCleanupWorkersAndJobs();

      expect(mockAliveStreamManager.isActive).toHaveBeenCalledWith('worker-1');
      expect(mockWorkerInstanceRepository.delete).toHaveBeenCalledWith(
        'worker-1',
      );
    });

    it('should skip stale workers that have active streams', async () => {
      const staleWorker = {
        id: 'worker-1',
        lastSeenAt: new Date(Date.now() - 120000),
      } as WorkerInstance;

      (mockWorkerInstanceRepository.find as jest.Mock).mockResolvedValue([
        staleWorker,
      ]);
      (mockAliveStreamManager.isActive as jest.Mock).mockReturnValue(true);

      // Mock resetStuckAndFailedJobs
      (mockWorkerInstanceRepository.manager as any) = {
        query: jest.fn().mockResolvedValue(undefined),
      };

      await service.autoCleanupWorkersAndJobs();

      expect(mockAliveStreamManager.isActive).toHaveBeenCalledWith('worker-1');
      expect(mockWorkerInstanceRepository.delete).not.toHaveBeenCalled();
    });

    it('should handle mixed workers: some active, some stale', async () => {
      const activeStreamWorker = {
        id: 'worker-1',
        lastSeenAt: new Date(Date.now() - 120000),
      } as WorkerInstance;
      const trulyStaleWorker = {
        id: 'worker-2',
        lastSeenAt: new Date(Date.now() - 120000),
      } as WorkerInstance;

      (mockWorkerInstanceRepository.find as jest.Mock).mockResolvedValue([
        activeStreamWorker,
        trulyStaleWorker,
      ]);
      (mockAliveStreamManager.isActive as jest.Mock)
        .mockReturnValueOnce(true) // worker-1 has active stream
        .mockReturnValueOnce(false); // worker-2 does not

      // Mock workerLeave dependencies
      (mockJobsRegistryService.repo as any).execute = jest.fn();
      (mockWorkerInstanceRepository.delete as jest.Mock).mockResolvedValue(
        undefined,
      );
      // Mock resetStuckAndFailedJobs
      (mockWorkerInstanceRepository.manager as any) = {
        query: jest.fn().mockResolvedValue(undefined),
      };

      await service.autoCleanupWorkersAndJobs();

      expect(mockWorkerInstanceRepository.delete).toHaveBeenCalledTimes(1);
      expect(mockWorkerInstanceRepository.delete).toHaveBeenCalledWith(
        'worker-2',
      );
    });

    it('should handle no stale workers', async () => {
      (mockWorkerInstanceRepository.find as jest.Mock).mockResolvedValue([]);

      // Mock resetStuckAndFailedJobs
      (mockWorkerInstanceRepository.manager as any) = {
        query: jest.fn().mockResolvedValue(undefined),
      };

      await service.autoCleanupWorkersAndJobs();

      expect(mockAliveStreamManager.isActive).not.toHaveBeenCalled();
      expect(mockWorkerInstanceRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('join', () => {
    it.each(['', 'change_me', 'short-secret'])(
      'rejects weak enrollment token %p',
      async (apiKey) => {
        (mockConfigService.get as jest.Mock).mockReturnValue(apiKey);

        await expect(service.join({ apiKey })).rejects.toThrow(
          'Worker enrollment token must be at least 32 characters',
        );
      },
    );

    it('accepts a strong configured enrollment token without a shared blank signature', async () => {
      const apiKey = 'a-strong-worker-enrollment-token-1234567890';
      (mockConfigService.get as jest.Mock).mockImplementation((key: string) =>
        key === 'OASM_CLOUD_APIKEY' ? apiKey : undefined,
      );
      (mockWorkerInstanceRepository.save as jest.Mock).mockResolvedValue(
        undefined,
      );
      (mockWorkerInstanceRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'worker-1',
        token: 'worker-token',
      });

      await expect(service.join({ apiKey })).resolves.toMatchObject({
        id: 'worker-1',
      });
    });

    it('rejoins with the issued per-worker token without resending enrollment credentials', async () => {
      (mockWorkerInstanceRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'worker-1',
        token: 'issued-worker-token',
      });

      await expect(
        service.join({ apiKey: '', token: 'issued-worker-token' }),
      ).resolves.toMatchObject({ id: 'worker-1' });
      expect(
        mockApiKeysService.apiKeysRepository?.findOne,
      ).not.toHaveBeenCalled();
    });
  });

  describe('updateWorkerSettings', () => {
    it('does not resolve a worker owned by another workspace', async () => {
      (mockWorkerInstanceRepository.findOne as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.updateWorkerSettings(
          'worker-1',
          { isPaused: true },
          'workspace-1',
        ),
      ).rejects.toThrow('Worker not found');
      expect(mockWorkerInstanceRepository.findOne).toHaveBeenCalledWith({
        where: [
          { id: 'worker-1', workspace: { id: 'workspace-1' } },
          { id: 'worker-1', scope: 'cloud' },
        ],
      });
    });
  });

  describe('reportScannerStatus', () => {
    it('persists normalized Nuclei engine and template health for the authenticated worker', async () => {
      (mockWorkerInstanceRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.reportScannerStatus('worker-1', {
        engineVersion: 'v3.11.0',
        templateVersion: 'v10.4.6',
        templateSource: 'projectdiscovery/nuclei-templates',
        state: 'ready',
        lastUpdateAttemptAt: '2026-07-20T12:00:00.000Z',
        lastUpdateSuccessAt: '2026-07-20T12:00:01.000Z',
        lastValidatedAt: '2026-07-20T12:00:02.000Z',
        lastError: '',
      });

      expect(mockWorkerInstanceRepository.update).toHaveBeenCalledWith(
        { id: 'worker-1' },
        {
          nucleiEngineVersion: 'v3.11.0',
          nucleiTemplateVersion: 'v10.4.6',
          nucleiTemplateSource: 'projectdiscovery/nuclei-templates',
          nucleiTemplateStatus: 'ready',
          nucleiTemplateLastAttemptAt: new Date('2026-07-20T12:00:00.000Z'),
          nucleiTemplateLastSuccessAt: new Date('2026-07-20T12:00:01.000Z'),
          nucleiTemplateValidatedAt: new Date('2026-07-20T12:00:02.000Z'),
          nucleiTemplateLastError: null,
          scannerStatusUpdatedAt: expect.any(Date),
        },
      );
    });

    it('rejects an unknown scanner state', async () => {
      await expect(
        service.reportScannerStatus('worker-1', {
          engineVersion: 'v3.11.0',
          templateVersion: 'v10.4.6',
          templateSource: 'projectdiscovery/nuclei-templates',
          state: 'compromised',
        }),
      ).rejects.toThrow('Unknown scanner status');

      expect(mockWorkerInstanceRepository.update).not.toHaveBeenCalled();
    });

    it.each([
      {
        name: 'oversized engine version',
        patch: { engineVersion: `v${'1'.repeat(65)}` },
        message: 'Invalid Nuclei engine version',
      },
      {
        name: 'invalid template version',
        patch: { templateVersion: 'latest;drop table workers' },
        message: 'Invalid Nuclei template version',
      },
      {
        name: 'untrusted template source',
        patch: { templateSource: 'https://attacker.invalid/templates' },
        message: 'Invalid Nuclei template source',
      },
      {
        name: 'oversized error',
        patch: { lastError: 'x'.repeat(2049) },
        message: 'exceeds 2048 characters',
      },
    ])('rejects $name', async ({ patch, message }) => {
      await expect(
        service.reportScannerStatus('worker-1', {
          engineVersion: 'v3.11.0',
          templateVersion: 'v10.4.6',
          templateSource: 'projectdiscovery/nuclei-templates',
          state: 'ready',
          ...patch,
        }),
      ).rejects.toThrow(message);

      expect(mockWorkerInstanceRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('getWorkerManagementScope', () => {
    it('returns the scope of a global worker', async () => {
      (mockWorkerInstanceRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'worker-1',
        scope: WorkerScope.CLOUD,
        workspaceId: null,
      });

      await expect(
        service.getWorkerManagementScope('worker-1', 'workspace-1'),
      ).resolves.toBe(WorkerScope.CLOUD);
    });

    it('returns the scope of a worker in the selected workspace', async () => {
      (mockWorkerInstanceRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'worker-1',
        scope: WorkerScope.WORKSPACE,
        workspaceId: 'workspace-1',
      });

      await expect(
        service.getWorkerManagementScope('worker-1', 'workspace-1'),
      ).resolves.toBe(WorkerScope.WORKSPACE);
    });

    it('hides a worker owned by another workspace', async () => {
      (mockWorkerInstanceRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'worker-1',
        scope: WorkerScope.WORKSPACE,
        workspaceId: 'workspace-2',
      });

      await expect(
        service.getWorkerManagementScope('worker-1', 'workspace-1'),
      ).rejects.toThrow('Worker not found');
    });
  });

  describe('connectInternalNetwork', () => {
    it('does not mutate the worker before the network workspace is validated', async () => {
      (mockWorkerInstanceRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'worker-1',
        workspace: { id: 'workspace-1' },
      });
      (mockInternalNetworkRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'network-1',
        workspaceId: 'workspace-2',
      });

      await expect(
        service.connectInternalNetwork({
          workerId: 'worker-1',
          networkId: 'network-1',
          networkInterfaces: [],
        }),
      ).rejects.toThrow('Network and worker belong to different workspaces');

      expect(mockWorkerInstanceRepository.update).not.toHaveBeenCalled();
    });
  });
});
