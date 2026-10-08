import type { UserContextPayload } from '@/common/interfaces/app.interface';
import { CronSchedule } from '@/common/enums/enum';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { In } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { AssetsService } from '../assets/assets.service';
import type { Asset } from '../assets/entities/assets.entity';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { Target, TargetType } from './entities/target.entity';
import { WorkspaceTarget } from './entities/workspace-target.entity';
import { TargetsService } from './targets.service';

describe('TargetsService', () => {
  let service: TargetsService;
  let mockTargetRepository: Partial<Repository<Target>>;
  let mockWorkspaceTargetRepository: Partial<Repository<WorkspaceTarget>>;
  let mockWorkspacesService: Partial<WorkspacesService>;
  let mockAssetsService: Partial<AssetsService>;
  let mockEventEmitter: Partial<EventEmitter2>;
  let mockQueue: Partial<Queue>;

  beforeEach(async () => {
    mockTargetRepository = {
      findOneBy: jest.fn(),
      upsert: jest.fn(),
      query: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(),
      getRawMany: jest.fn(),
      getCount: jest.fn(),
      update: jest.fn(),
      findOne: jest.fn(),
      findByIds: jest.fn(),
      manager: {
        transaction: jest.fn(),
        getRepository: jest.fn(),
      } as unknown as EntityManager,
    } as any;

    mockWorkspaceTargetRepository = {
      findOneBy: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
      save: jest.fn(),
      count: jest.fn(),
    } as any;

    mockWorkspacesService = {
      getWorkspaceById: jest.fn(),
      getWorkspaceConfigValue: jest.fn(),
    };

    mockAssetsService = {
      createPrimaryAsset: jest.fn(),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    mockQueue = {
      add: jest.fn(),
      removeJobScheduler: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TargetsService,
        {
          provide: getRepositoryToken(Target),
          useValue: mockTargetRepository,
        },
        {
          provide: getRepositoryToken(WorkspaceTarget),
          useValue: mockWorkspaceTargetRepository,
        },
        {
          provide: WorkspacesService,
          useValue: mockWorkspacesService,
        },
        {
          provide: AssetsService,
          useValue: mockAssetsService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: 'BullQueue_assets-discovery-schedule', // Queue name for BullMQ
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<TargetsService>(TargetsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getTargetById', () => {
    const targetId = randomUUID();
    const workspaceId = randomUUID();

    it('fetches the target with one parameterized query and returns the first row', async () => {
      const row = {
        id: targetId,
        value: 'example.com',
        type: TargetType.DOMAIN,
        totalAssetServices: 5,
        status: 'completed',
      };
      (mockTargetRepository.query as jest.Mock).mockResolvedValue([row]);

      const result = await service.getTargetById(targetId, workspaceId);

      expect(result).toBe(row);
      const [sql, params] = (mockTargetRepository.query as jest.Mock).mock
        .calls[0] as [string, unknown[]];
      expect(params).toEqual([targetId, workspaceId]);
      // Regression guard: asset_services and jobs must each be aggregated in
      // their own LATERAL subquery. Joining them as siblings off assets forms
      // a services x jobs cartesian product per asset, which exceeds
      // statement_timeout on large targets (see getTargetsInWorkspace).
      expect(sql).toContain('LATERAL');
    });

    it('counts every discovered service without gating on isErrorPage', async () => {
      (mockTargetRepository.query as jest.Mock).mockResolvedValue([
        { id: targetId, totalAssetServices: 10 },
      ]);

      await service.getTargetById(targetId, workspaceId);

      const [sql] = (mockTargetRepository.query as jest.Mock).mock.calls[0] as [
        string,
        unknown[],
      ];
      // The services count reflects discovered service endpoints (naabu open
      // ports). isErrorPage is set from httpx's flaky `failed` flag, so gating
      // the count on it made a target scanned during a transient IPS block
      // (all probes failed) report 0 services despite real discovered services.
      expect(sql).toContain('COUNT(DISTINCT s.id)');
      expect(sql).not.toContain('"isErrorPage"');
    });

    it('includes persisted scan window fields in the target detail projection', async () => {
      (mockTargetRepository.query as jest.Mock).mockResolvedValue([
        {
          id: targetId,
          scanWindowStart: '22:00:00',
          scanWindowEnd: '06:00:00',
          scanWindowTimezone: 'America/Chicago',
          scanWindowDays: [1, 2, 3],
        },
      ]);

      await service.getTargetById(targetId, workspaceId);

      const [sql] = (mockTargetRepository.query as jest.Mock).mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('t."scanWindowStart" AS "scanWindowStart"');
      expect(sql).toContain('t."scanWindowEnd" AS "scanWindowEnd"');
      expect(sql).toContain('t."scanWindowTimezone" AS "scanWindowTimezone"');
      expect(sql).toContain('t."scanWindowDays" AS "scanWindowDays"');
    });

    it('returns undefined when the target is not in the workspace', async () => {
      (mockTargetRepository.query as jest.Mock).mockResolvedValue([]);

      await expect(
        service.getTargetById(targetId, workspaceId),
      ).resolves.toBeUndefined();
    });
  });

  describe('getTargetsInWorkspace', () => {
    it('counts every discovered service without gating on isErrorPage', async () => {
      const workspaceId = randomUUID();
      (mockTargetRepository.query as jest.Mock)
        .mockResolvedValueOnce([{ cnt: 1 }]) // total count query
        .mockResolvedValueOnce([]); // list page query

      await service.getTargetsInWorkspace(
        { limit: 10, page: 1 } as Parameters<
          TargetsService['getTargetsInWorkspace']
        >[0],
        workspaceId,
      );

      const calls = (mockTargetRepository.query as jest.Mock).mock.calls;
      // The paginated list query carries the totalAssetServices count subquery;
      // it must count all discovered services, not exclude httpx-failed ones.
      const listSql = calls[1][0] as string;
      expect(listSql).toContain('COUNT(DISTINCT s.id)');
      expect(listSql).not.toContain('"isErrorPage"');
    });
  });

  describe('updateTarget', () => {
    it('returns the updated target after persisting scan window changes', async () => {
      const targetId = randomUUID();
      const workspaceId = randomUUID();
      const existingTarget = {
        id: targetId,
        value: 'example.com',
        type: TargetType.DOMAIN,
      } as Target;
      const updatedTarget = {
        ...existingTarget,
        scanWindowStart: '22:00',
        scanWindowEnd: '06:00',
        scanWindowTimezone: 'America/Chicago',
        scanWindowDays: [1, 2, 3, 4, 5],
      } as Target;

      (mockTargetRepository.findOneBy as jest.Mock)
        .mockResolvedValueOnce(existingTarget)
        .mockResolvedValueOnce(updatedTarget);
      (mockTargetRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });
      (mockWorkspaceTargetRepository.findOneBy as jest.Mock).mockResolvedValue({
        target: { id: targetId },
        workspace: { id: workspaceId },
      });

      const result = await service.updateTarget(targetId, {
        scanWindowStart: '22:00',
        scanWindowEnd: '06:00',
        scanWindowTimezone: 'America/Chicago',
        scanWindowDays: [1, 2, 3, 4, 5],
      }, workspaceId);

      expect(mockTargetRepository.update).toHaveBeenCalledWith(targetId, {
        scanWindowStart: '22:00',
        scanWindowEnd: '06:00',
        scanWindowTimezone: 'America/Chicago',
        scanWindowDays: [1, 2, 3, 4, 5],
        jobId: undefined,
      });
      expect(result).toEqual(updatedTarget);
    });

    it('reschedules an enabled target when scan window timing changes', async () => {
      const targetId = randomUUID();
      const workspaceId = randomUUID();
      const existingTarget = {
        id: targetId,
        value: 'example.com',
        type: TargetType.DOMAIN,
        scanSchedule: CronSchedule.MONTHLY,
        jobId: 'old-repeat-key',
        reScanCount: 0,
      } as Target;
      const updatedTarget = {
        ...existingTarget,
        scanWindowStart: '23:05',
        scanWindowEnd: '23:10',
        scanWindowTimezone: 'America/Chicago',
        scanWindowDays: [1, 2, 3, 4, 5, 6, 7],
      } as Target;

      (mockTargetRepository.findOneBy as jest.Mock)
        .mockResolvedValueOnce(existingTarget)
        .mockResolvedValueOnce(updatedTarget);
      (mockTargetRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });
      (mockQueue.add as jest.Mock).mockResolvedValue({
        repeatJobKey: 'new-repeat-key',
      });
      (mockWorkspaceTargetRepository.findOneBy as jest.Mock).mockResolvedValue({
        target: { id: targetId },
        workspace: { id: workspaceId },
      });

      await service.updateTarget(targetId, {
        scanWindowStart: '23:05',
        scanWindowEnd: '23:10',
        scanWindowTimezone: 'America/Chicago',
        scanWindowDays: [1, 2, 3, 4, 5, 6, 7],
      }, workspaceId);

      expect(mockQueue.removeJobScheduler).toHaveBeenCalledWith(
        'old-repeat-key',
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        targetId,
        { id: targetId },
        {
          repeat: {
            pattern: '5 23 1 * *',
            tz: 'America/Chicago',
            immediately: true,
          },
        },
      );
      expect(mockTargetRepository.update).toHaveBeenCalledWith(
        targetId,
        expect.objectContaining({ jobId: 'new-repeat-key' }),
      );
    });

    it('does not update a target outside the selected workspace', async () => {
      const targetId = randomUUID();
      const workspaceId = randomUUID();
      (mockWorkspaceTargetRepository.findOneBy as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.updateTarget(
          targetId,
          { scanSchedule: CronSchedule.DAILY },
          workspaceId,
        ),
      ).rejects.toThrow('Target not found in workspace');

      expect(mockTargetRepository.findOneBy).not.toHaveBeenCalled();
      expect(mockTargetRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('reScanTarget', () => {
    it('does not rescan a target outside the selected workspace', async () => {
      const targetId = randomUUID();
      const workspaceId = randomUUID();
      (mockWorkspaceTargetRepository.findOneBy as jest.Mock).mockResolvedValue(
        null,
      );
      mockAssetsService.reScan = jest.fn();

      await expect(
        service.reScanTarget(targetId, workspaceId),
      ).rejects.toThrow('Target not found in workspace');
      expect(mockAssetsService.reScan).not.toHaveBeenCalled();
    });
  });

  describe('deleteTargetFromWorkspace', () => {
    const createTransaction = (workspaceTarget: WorkspaceTarget | null, remaining: number) => {
      const transactionWorkspaceTargetRepository = {
        findOne: jest.fn().mockResolvedValue(workspaceTarget),
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
        count: jest.fn().mockResolvedValue(remaining),
      };
      const transactionTargetRepository = {
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      const manager = {
        getRepository: jest.fn((entity) =>
          entity === WorkspaceTarget
            ? transactionWorkspaceTargetRepository
            : transactionTargetRepository,
        ),
      };
      (mockTargetRepository.manager?.transaction as jest.Mock).mockImplementation(
        async (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
      );
      return {
        transactionWorkspaceTargetRepository,
        transactionTargetRepository,
      };
    };

    it('checks workspace membership before deleting anything', async () => {
      const targetId = randomUUID();
      const workspaceId = randomUUID();
      const repositories = createTransaction(null, 0);

      await expect(
        service.deleteTargetFromWorkspace(targetId, workspaceId),
      ).rejects.toThrow('Target not found in workspace');

      expect(
        repositories.transactionWorkspaceTargetRepository.delete,
      ).not.toHaveBeenCalled();
      expect(repositories.transactionTargetRepository.delete).not.toHaveBeenCalled();
    });

    it('removes only the association when another workspace still owns the target', async () => {
      const targetId = randomUUID();
      const workspaceId = randomUUID();
      const repositories = createTransaction(
        {
          target: { id: targetId },
          workspace: { id: workspaceId },
        } as WorkspaceTarget,
        1,
      );

      await service.deleteTargetFromWorkspace(targetId, workspaceId);

      expect(
        repositories.transactionWorkspaceTargetRepository.delete,
      ).toHaveBeenCalled();
      expect(repositories.transactionTargetRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('createMultipleTargets', () => {
    const workspaceId = randomUUID();
    const userContext = {
      userId: randomUUID(),
      email: 'test@example.com',
      expiresAt: new Date(),
      token: 'token',
      createdAt: new Date(),
      updatedAt: new Date(),
      name: 'Test User',
      image: null,
      role: 'USER',
      lastLoginAt: new Date(),
      isActive: true,
      version: 1,
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
      id: randomUUID(),
      emailVerified: new Date(),
    } as unknown as UserContextPayload;

    // Helper to create mock EntityManager
    const createMockEntityManager = (options: {
      existingTargets?: string[];
      insertResult?: { identifiers: Array<{ id: string }> };
      createdTargets?: Target[];
    }) => {
      const {
        existingTargets = [],
        insertResult,
        createdTargets = [],
      } = options;

      const mockWorkspaceTargetRepo = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(
          existingTargets.map((value) => ({
            value,
            internalNetworkId: null,
          })),
        ),
        save: jest.fn().mockResolvedValue(undefined),
      };

      const mockTargetRepo: Record<string, jest.Mock> = {
        createQueryBuilder: jest.fn(),
        insert: jest.fn(),
        into: jest.fn(),
        values: jest.fn(),
        execute: jest.fn().mockResolvedValue(
          insertResult || {
            identifiers: createdTargets.map((t) => ({ id: t.id })),
          },
        ),
        findByIds: jest.fn().mockResolvedValue(createdTargets),
      };

      // Setup chaining
      mockTargetRepo.createQueryBuilder.mockReturnValue(mockTargetRepo);
      mockTargetRepo.insert.mockReturnValue(mockTargetRepo);
      mockTargetRepo.into.mockReturnValue(mockTargetRepo);
      mockTargetRepo.values.mockReturnValue(mockTargetRepo);

      const mockAssetRepo = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      };

      // Create a mock query builder for direct EntityManager usage
      const mockQueryBuilder = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          identifiers: createdTargets.map((t) => ({ id: t.id })),
        }),
      };

      return {
        getRepository: jest.fn((entity: { name: string }) => {
          if (entity.name === 'WorkspaceTarget')
            return mockWorkspaceTargetRepo as unknown as Repository<WorkspaceTarget>;
          if (entity.name === 'Target')
            return mockTargetRepo as unknown as Repository<Target>;
          if (entity.name === 'Asset')
            return mockAssetRepo as unknown as Repository<Asset>;
          return {} as Repository<never>;
        }),
        createQueryBuilder: jest.fn(() => mockQueryBuilder),
      } as unknown as EntityManager;
    };

    beforeEach(() => {
      mockWorkspacesService.getWorkspaceById = jest
        .fn()
        .mockResolvedValue({ id: workspaceId });
      mockEventEmitter.emit = jest.fn();
      // Mock updateTarget to avoid BullMQ issues
      jest
        .spyOn(service, 'updateTarget')
        .mockResolvedValue({ affected: 1 } as any);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should create multiple targets successfully', async () => {
      // Arrange
      const targetValues = ['target1.com', 'target2.com', 'target3.com'];
      const dto = { targets: targetValues.map((value) => ({ value })) };
      const createdTargets = targetValues.map((value) => ({
        id: randomUUID(),
        value,
        type: TargetType.DOMAIN,
        scanSchedule: 'DISABLED',
      })) as unknown as Target[];

      const mockManager = createMockEntityManager({
        existingTargets: [],
        createdTargets,
      });

      (mockTargetRepository.manager as EntityManager).transaction = jest
        .fn()
        .mockImplementation(
          (callback: (manager: EntityManager) => Promise<unknown>) =>
            callback(mockManager),
        );

      // Act
      const result = await service.createMultipleTargets(
        dto,
        workspaceId,
        userContext,
      );

      // Assert
      expect(result.created).toHaveLength(3);
      expect(result.totalCreated).toBe(3);
      expect(result.totalSkipped).toBe(0);
      expect(result.skipped).toEqual([]);
      expect(result.totalRequested).toBe(3);
      expect(
        mockWorkspacesService.getWorkspaceById,
      ).toHaveBeenCalledWith(workspaceId, userContext);
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(3);
    });

    it('should throw BadRequestException when duplicate targets exist', async () => {
      // Arrange
      const targetValues = [
        'existing.com',
        'new1.com',
        'existing2.com',
        'new2.com',
      ];
      const dto = { targets: targetValues.map((value) => ({ value })) };

      const mockManager = createMockEntityManager({
        existingTargets: ['existing.com', 'existing2.com'],
        createdTargets: [],
      });

      (mockTargetRepository.manager as EntityManager).transaction = jest
        .fn()
        .mockImplementation(
          (callback: (manager: EntityManager) => Promise<unknown>) =>
            callback(mockManager),
        );

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow('Target already exists: existing.com, existing2.com');
    });

    it('should throw BadRequestException when all targets are duplicates', async () => {
      // Arrange
      const targetValues = ['dup1.com', 'dup2.com'];
      const dto = { targets: targetValues.map((value) => ({ value })) };

      const mockManager = createMockEntityManager({
        existingTargets: ['dup1.com', 'dup2.com'],
        createdTargets: [],
      });

      (mockTargetRepository.manager as EntityManager).transaction = jest
        .fn()
        .mockImplementation(
          (callback: (manager: EntityManager) => Promise<unknown>) =>
            callback(mockManager),
        );

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow('Target already exists: dup1.com, dup2.com');
    });

    it('should handle empty targets array', async () => {
      // Arrange
      const dto = { targets: [] };

      const mockManager = createMockEntityManager({
        existingTargets: [],
        createdTargets: [],
      });

      (mockTargetRepository.manager as EntityManager).transaction = jest
        .fn()
        .mockImplementation(
          (callback: (manager: EntityManager) => Promise<unknown>) =>
            callback(mockManager),
        );

      // Act
      const result = await service.createMultipleTargets(
        dto,
        workspaceId,
        userContext,
      );

      // Assert
      expect(result.created).toHaveLength(0);
      expect(result.totalCreated).toBe(0);
      expect(result.totalSkipped).toBe(0);
      expect(result.totalRequested).toBe(0);
    });

    it('should emit events for each created target', async () => {
      // Arrange
      const targetValues = ['event1.com', 'event2.com'];
      const dto = { targets: targetValues.map((value) => ({ value })) };
      const createdTargets = targetValues.map((value) => ({
        id: randomUUID(),
        value,
        type: TargetType.DOMAIN,
        scanSchedule: 'DISABLED',
      })) as unknown as Target[];

      const mockManager = createMockEntityManager({
        existingTargets: [],
        createdTargets,
      });

      (mockTargetRepository.manager as EntityManager).transaction = jest
        .fn()
        .mockImplementation(
          (callback: (manager: EntityManager) => Promise<unknown>) =>
            callback(mockManager),
        );

      // Act
      await service.createMultipleTargets(dto, workspaceId, userContext);

      // Assert
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(2);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'target.domain.create',
        expect.any(Object),
      );
    });

    it('should not emit events when startDiscovery is false', async () => {
      // Arrange
      const targetValues = ['noscan1.com', 'noscan2.com'];
      const dto = {
        targets: targetValues.map((value) => ({ value })),
        startDiscovery: false,
      };
      const createdTargets = targetValues.map((value) => ({
        id: randomUUID(),
        value,
        type: TargetType.DOMAIN,
        scanSchedule: 'DISABLED',
      })) as unknown as Target[];

      const mockManager = createMockEntityManager({
        existingTargets: [],
        createdTargets,
      });

      (mockTargetRepository.manager as EntityManager).transaction = jest
        .fn()
        .mockImplementation(
          (callback: (manager: EntityManager) => Promise<unknown>) =>
            callback(mockManager),
        );

      // Act
      const result = await service.createMultipleTargets(
        dto,
        workspaceId,
        userContext,
      );

      // Assert
      expect(result.totalCreated).toBe(2);
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should emit events when startDiscovery is explicitly true', async () => {
      // Arrange
      const dto = {
        targets: [{ value: 'scan1.com' }],
        startDiscovery: true,
      };
      const createdTargets = [
        {
          id: randomUUID(),
          value: 'scan1.com',
          type: TargetType.DOMAIN,
          scanSchedule: 'DISABLED',
        },
      ] as unknown as Target[];

      const mockManager = createMockEntityManager({
        existingTargets: [],
        createdTargets,
      });

      (mockTargetRepository.manager as EntityManager).transaction = jest
        .fn()
        .mockImplementation(
          (callback: (manager: EntityManager) => Promise<unknown>) =>
            callback(mockManager),
        );

      // Act
      await service.createMultipleTargets(dto, workspaceId, userContext);

      // Assert
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'target.domain.create',
        expect.any(Object),
      );
    });

    it('should throw BadRequestException for IP address as domain', async () => {
      // Arrange
      const dto = {
        targets: [{ value: '192.168.1.1', type: TargetType.DOMAIN }],
      };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid domain: "192.168.1.1" is an IP address. Use type IP for single IP addresses or CIDR for IP ranges.',
      );
    });

    it('should throw BadRequestException for invalid domain format', async () => {
      // Arrange
      const dto = {
        targets: [{ value: 'invalid-domain', type: TargetType.DOMAIN }],
      };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid domain: "invalid-domain" is not a valid root domain.',
      );
    });

    it('should throw BadRequestException for CIDR with invalid prefix', async () => {
      // Arrange
      const dto = {
        targets: [{ value: '192.168.1.0/16', type: TargetType.CIDR }],
      };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid CIDR: "192.168.1.0/16" must use /24 prefix. Only /24 CIDR ranges are supported.',
      );
    });

    it('should throw BadRequestException for invalid CIDR format', async () => {
      // Arrange
      const dto = {
        targets: [{ value: '192.168.1.0/24/32', type: TargetType.CIDR }],
      };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid CIDR: "192.168.1.0/24/32" is not a valid CIDR notation. Expected format: x.x.x.x/y',
      );
    });

    it('should throw BadRequestException for CIDR with invalid octet', async () => {
      // Arrange
      const dto = {
        targets: [{ value: '256.168.1.0/24', type: TargetType.CIDR }],
      };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid CIDR: "256.168.1.0/24" contains invalid IP octet. Each octet must be 0-255.',
      );
    });

    it('should throw BadRequestException for localhost CIDR (127.0.0.0/24)', async () => {
      // Arrange
      const dto = {
        targets: [{ value: '127.0.0.0/24', type: TargetType.CIDR }],
      };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid CIDR: "127.0.0.0/24" is a private/reserved IP range. Only public IP ranges are allowed.',
      );
    });

    it('should throw BadRequestException for private IP CIDR (10.0.0.0/24)', async () => {
      // Arrange
      const dto = {
        targets: [{ value: '10.0.0.0/24', type: TargetType.CIDR }],
      };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid CIDR: "10.0.0.0/24" is a private/reserved IP range. Only public IP ranges are allowed.',
      );
    });

    it('should throw BadRequestException for private IP CIDR (172.16.0.0/24)', async () => {
      // Arrange
      const dto = {
        targets: [{ value: '172.16.0.0/24', type: TargetType.CIDR }],
      };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid CIDR: "172.16.0.0/24" is a private/reserved IP range. Only public IP ranges are allowed.',
      );
    });

    it('should throw BadRequestException for private IP CIDR (192.168.0.0/24)', async () => {
      // Arrange
      const dto = {
        targets: [{ value: '192.168.0.0/24', type: TargetType.CIDR }],
      };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid CIDR: "192.168.0.0/24" is a private/reserved IP range. Only public IP ranges are allowed.',
      );
    });

    it('should throw BadRequestException for link-local CIDR (169.254.0.0/24)', async () => {
      // Arrange
      const dto = {
        targets: [{ value: '169.254.0.0/24', type: TargetType.CIDR }],
      };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid CIDR: "169.254.0.0/24" is a private/reserved IP range. Only public IP ranges are allowed.',
      );
    });

    it('should throw BadRequestException for multicast CIDR (224.0.0.0/24)', async () => {
      // Arrange
      const dto = {
        targets: [{ value: '224.0.0.0/24', type: TargetType.CIDR }],
      };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid CIDR: "224.0.0.0/24" is a private/reserved IP range. Only public IP ranges are allowed.',
      );
    });

    it('should throw BadRequestException for reserved CIDR (240.0.0.0/24)', async () => {
      // Arrange
      const dto = {
        targets: [{ value: '240.0.0.0/24', type: TargetType.CIDR }],
      };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid CIDR: "240.0.0.0/24" is a private/reserved IP range. Only public IP ranges are allowed.',
      );
    });

    it('should validate all targets before processing', async () => {
      // Arrange
      const dto = {
        targets: [
          { value: 'valid.com', type: TargetType.DOMAIN },
          { value: '8.8.8.0/24', type: TargetType.CIDR },
          { value: '192.168.1.1', type: TargetType.DOMAIN }, // Invalid - IP as domain
        ],
      };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid domain: "192.168.1.1" is an IP address. Use type IP for single IP addresses or CIDR for IP ranges.',
      );
    });

    it('should create valid domain and CIDR targets', async () => {
      // Arrange
      const dto = {
        targets: [
          { value: 'example.com', type: TargetType.DOMAIN },
          { value: '8.8.8.0/24', type: TargetType.CIDR }, // Google DNS - public IP
        ],
      };
      const createdTargets = [
        {
          id: randomUUID(),
          value: 'example.com',
          type: TargetType.DOMAIN,
          scanSchedule: 'DISABLED',
        },
        {
          id: randomUUID(),
          value: '8.8.8.0/24',
          type: TargetType.CIDR,
          scanSchedule: 'DISABLED',
        },
      ] as unknown as Target[];

      const mockManager = createMockEntityManager({
        existingTargets: [],
        createdTargets,
      });

      (mockTargetRepository.manager as EntityManager).transaction = jest
        .fn()
        .mockImplementation(
          (callback: (manager: EntityManager) => Promise<unknown>) =>
            callback(mockManager),
        );

      // Act
      const result = await service.createMultipleTargets(
        dto,
        workspaceId,
        userContext,
      );

      // Assert
      expect(result.created).toHaveLength(2);
      expect(result.totalCreated).toBe(2);
      expect(result.totalSkipped).toBe(0);
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(2);
    });

    it('should create 256 assets for CIDR target', async () => {
      // Arrange
      const dto = {
        targets: [{ value: '8.8.8.0/24', type: TargetType.CIDR }],
      };
      const createdTargets = [
        {
          id: randomUUID(),
          value: '8.8.8.0/24',
          type: TargetType.CIDR,
          scanSchedule: 'DISABLED',
        },
      ] as unknown as Target[];

      const mockManager = createMockEntityManager({
        existingTargets: [],
        createdTargets,
      });

      (mockTargetRepository.manager as EntityManager).transaction = jest
        .fn()
        .mockImplementation(
          (callback: (manager: EntityManager) => Promise<unknown>) =>
            callback(mockManager),
        );

      // Act
      const result = await service.createMultipleTargets(
        dto,
        workspaceId,
        userContext,
      );

      // Assert
      expect(result.created).toHaveLength(1);
      expect(result.totalCreated).toBe(1);
    });

    it('should expand CIDR to 256 IPs correctly', () => {
      // Arrange
      const cidr = '8.8.8.0/24';

      // Act
      const ips = (service as any).expandCIDRToIPs(cidr);

      // Assert
      expect(ips).toHaveLength(256);
      expect(ips[0]).toBe('8.8.8.0');
      expect(ips[1]).toBe('8.8.8.1');
      expect(ips[255]).toBe('8.8.8.255');
    });

    it('should default to DOMAIN type when type is not specified', async () => {
      // Arrange
      const dto = { targets: [{ value: 'example.com' }] };
      const createdTargets = [
        {
          id: randomUUID(),
          value: 'example.com',
          type: TargetType.DOMAIN,
          scanSchedule: 'DISABLED',
        },
      ] as unknown as Target[];

      const mockManager = createMockEntityManager({
        existingTargets: [],
        createdTargets,
      });

      (mockTargetRepository.manager as EntityManager).transaction = jest
        .fn()
        .mockImplementation(
          (callback: (manager: EntityManager) => Promise<unknown>) =>
            callback(mockManager),
        );

      // Act
      const result = await service.createMultipleTargets(
        dto,
        workspaceId,
        userContext,
      );

      // Assert
      expect(result.created).toHaveLength(1);
      expect(result.totalCreated).toBe(1);
    });

    it('should create valid IP target', async () => {
      // Arrange
      const dto = {
        targets: [{ value: '8.8.8.8', type: TargetType.IP }],
      };
      const createdTargets = [
        {
          id: randomUUID(),
          value: '8.8.8.8',
          type: TargetType.IP,
          scanSchedule: 'DISABLED',
        },
      ] as unknown as Target[];

      const mockManager = createMockEntityManager({
        existingTargets: [],
        createdTargets,
      });

      (mockTargetRepository.manager as EntityManager).transaction = jest
        .fn()
        .mockImplementation(
          (callback: (manager: EntityManager) => Promise<unknown>) =>
            callback(mockManager),
        );

      // Act
      const result = await service.createMultipleTargets(
        dto,
        workspaceId,
        userContext,
      );

      // Assert
      expect(result.created).toHaveLength(1);
      expect(result.totalCreated).toBe(1);
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'target.ip.create',
        expect.any(Object),
      );
    });

    it('should throw BadRequestException for invalid IP format', async () => {
      // Arrange
      const dto = { targets: [{ value: 'invalid-ip', type: TargetType.IP }] };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid IP: "invalid-ip" is not a valid IPv4 address. Expected format: x.x.x.x',
      );
    });

    it('should throw BadRequestException for IP with invalid octet', async () => {
      // Arrange
      const dto = { targets: [{ value: '256.1.1.1', type: TargetType.IP }] };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid IP: "256.1.1.1" contains invalid IP octet. Each octet must be 0-255.',
      );
    });

    it('should throw BadRequestException for private IP address', async () => {
      // Arrange
      const dto = { targets: [{ value: '192.168.1.1', type: TargetType.IP }] };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid IP: "192.168.1.1" is a private/reserved IP address. Only public IP addresses are allowed.',
      );
    });

    it('should throw BadRequestException for localhost IP address', async () => {
      // Arrange
      const dto = { targets: [{ value: '127.0.0.1', type: TargetType.IP }] };

      // Act & Assert
      await expect(
        service.createMultipleTargets(dto, workspaceId, userContext),
      ).rejects.toThrow(
        'Invalid IP: "127.0.0.1" is a private/reserved IP address. Only public IP addresses are allowed.',
      );
    });
  });

  describe('discoverTargets', () => {
    const workspaceId = randomUUID();
    const userContext = {
      userId: randomUUID(),
      email: 'test@example.com',
      expiresAt: new Date(),
      token: 'token',
      createdAt: new Date(),
      updatedAt: new Date(),
      name: 'Test User',
      image: null,
      role: 'USER',
      lastLoginAt: new Date(),
      isActive: true,
      version: 1,
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
      id: randomUUID(),
      emailVerified: new Date(),
    } as unknown as UserContextPayload;

    const makeTarget = (type: TargetType, value: string) =>
      ({
        id: randomUUID(),
        value,
        type,
        reScanCount: 0,
      }) as unknown as Target;

    // Chainable query-builder mock for the single batched
    // UPDATE ... SET "reScanCount" = "reScanCount" + 1 statement.
    let mockUpdateQueryBuilder: {
      update: jest.Mock;
      set: jest.Mock;
      where: jest.Mock;
      execute: jest.Mock;
    };

    beforeEach(() => {
      mockWorkspacesService.getWorkspaceById = jest.fn();
      mockWorkspacesService.getWorkspaceConfigValue = jest
        .fn()
        .mockResolvedValue({ isAssetsDiscovery: true });
      mockEventEmitter.emit = jest.fn();
      mockUpdateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      (mockTargetRepository.createQueryBuilder as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockUpdateQueryBuilder);
      (mockTargetRepository.query as jest.Mock) = jest
        .fn()
        .mockResolvedValue([]);
    });

    const arrangeWorkspaceTargets = (targets: Target[]) => {
      (mockWorkspaceTargetRepository as any).find = jest
        .fn()
        .mockResolvedValue(targets.map((target) => ({ target })));
    };

    it('should emit type-correct re-scan events for idle targets', async () => {
      const domainTarget = makeTarget(TargetType.DOMAIN, 'example.com');
      const ipTarget = makeTarget(TargetType.IP, '8.8.8.8');
      const cidrTarget = makeTarget(TargetType.CIDR, '203.0.113.0/24');
      arrangeWorkspaceTargets([domainTarget, ipTarget, cidrTarget]);

      const result = await service.discoverTargets(
        { targetIds: [domainTarget.id, ipTarget.id, cidrTarget.id] },
        workspaceId,
        userContext,
      );

      expect(result.totalStarted).toBe(3);
      expect(result.totalSkipped).toBe(0);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'target.domain.re-scan',
        domainTarget,
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'target.ip.re-scan',
        ipTarget,
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'target.cidr.re-scan',
        cidrTarget,
      );
      // One batched atomic UPDATE for all started targets, not N per-row
      // read-modify-write updates.
      expect(mockUpdateQueryBuilder.execute).toHaveBeenCalledTimes(1);
      expect(mockUpdateQueryBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({
          reScanCount: expect.any(Function),
          lastDiscoveredAt: expect.any(Date),
        }),
      );
      expect(mockUpdateQueryBuilder.where).toHaveBeenCalledWith({
        id: In([domainTarget.id, ipTarget.id, cidrTarget.id]),
      });
    });

    it('should skip targets with pending or in-progress jobs', async () => {
      const busyTarget = makeTarget(TargetType.DOMAIN, 'busy.com');
      const idleTarget = makeTarget(TargetType.DOMAIN, 'idle.com');
      arrangeWorkspaceTargets([busyTarget, idleTarget]);
      (mockTargetRepository.query as jest.Mock) = jest
        .fn()
        .mockResolvedValue([{ targetId: busyTarget.id }]);

      const result = await service.discoverTargets(
        { targetIds: [busyTarget.id, idleTarget.id] },
        workspaceId,
        userContext,
      );

      expect(result.totalStarted).toBe(1);
      expect(result.totalSkipped).toBe(1);
      expect(result.skipped[0]).toEqual({
        id: busyTarget.id,
        value: 'busy.com',
        reason: 'already scanning',
      });
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'target.domain.re-scan',
        idleTarget,
      );
      expect(mockUpdateQueryBuilder.execute).toHaveBeenCalledTimes(1);
      expect(mockUpdateQueryBuilder.where).toHaveBeenCalledWith({
        id: In([idleTarget.id]),
      });
    });

    it('should throw NotFoundException for targets outside the workspace', async () => {
      arrangeWorkspaceTargets([]);

      await expect(
        service.discoverTargets(
          { targetIds: [randomUUID()] },
          workspaceId,
          userContext,
        ),
      ).rejects.toThrow('Targets not found in workspace');
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when asset discovery is disabled', async () => {
      mockWorkspacesService.getWorkspaceConfigValue = jest
        .fn()
        .mockResolvedValue({ isAssetsDiscovery: false });

      await expect(
        service.discoverTargets(
          { targetIds: [randomUUID()] },
          workspaceId,
          userContext,
        ),
      ).rejects.toThrow('Asset discovery is disabled for this workspace');
    });
  });
});
