import { WORKER_TIMEOUT } from '@/common/constants/app.constants';
import { GetManyBaseResponseDto } from '@/common/dtos/get-many-base.dto';
import {
  ApiKeyType,
  JobStatus,
  WorkerScope,
  WorkerType,
} from '@/common/enums/enum';
import { generateToken } from '@/utils/genToken';
import { getManyResponse } from '@/utils/getManyResponse';
import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID, timingSafeEqual } from 'crypto';
import { LessThan, Repository } from 'typeorm';
import { ApiKeysService } from '../apikeys/apikeys.service';
import { Asset } from '../assets/entities/assets.entity';
import { InternalNetwork } from '../internal-networks/entities/internal-network.entity';
import { NetworkInterface } from '../internal-networks/entities/network-interface.entity';
import { JobsRegistryService } from '../jobs-registry/jobs-registry.service';
import { Tool } from '../tools/entities/tools.entity';
import { WorkspaceTool } from '../tools/entities/workspace_tools.entity';
import { ToolsService } from '../tools/tools.service';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { AliveStreamManager } from './alive-stream-manager.service';
import {
  GetManyWorkersDto,
  ScannerStatusReportDto,
  UpdateWorkerSettingsDto,
  WorkerAliveDto,
  WorkerJoinDto,
} from './dto/workers.dto';
import { WorkerInstance } from './entities/worker.entity';

@Injectable()
export class WorkersService {
  private logger = new Logger('WorkersService');
  constructor(
    @InjectRepository(WorkerInstance)
    public readonly repo: Repository<WorkerInstance>,

    @InjectRepository(Asset)
    public readonly assetRepo: Repository<Asset>,

    @InjectRepository(WorkspaceTool)
    public readonly workspaceToolRepo: Repository<WorkspaceTool>,

    @InjectRepository(InternalNetwork)
    private internalNetworkRepo: Repository<InternalNetwork>,

    @InjectRepository(NetworkInterface)
    private networkInterfaceRepo: Repository<NetworkInterface>,

    @Inject(forwardRef(() => JobsRegistryService))
    private jobsRegistryService: JobsRegistryService,

    private apiKeyService: ApiKeysService,

    private configService: ConfigService,

    @Inject(forwardRef(() => ToolsService))
    private toolsService: ToolsService,

    private aliveStreamManager: AliveStreamManager,
  ) {}

  /**
   * Handles a worker's "alive" signal, which is sent
   * whenever a worker boots up or restarts.
   *
   * @param req The express request.
   * @param res The express response.
   * @param workerId The worker's unique identifier.
   */
  public async alive(dto: WorkerAliveDto) {
    const worker = await this.repo.findOne({
      where: { token: dto.token },
    });

    if (!worker) {
      throw new UnauthorizedException('Invalid token');
    }

    await this.repo.update({ token: dto.token }, { lastSeenAt: new Date() });

    return this.repo.findOne({ where: { token: dto.token } });
  }

  /** Persists bounded scanner health reported by an authenticated worker. */
  public async reportScannerStatus(
    workerId: string,
    status: ScannerStatusReportDto,
  ): Promise<{ message: string }> {
    const allowedStates = new Set(['ready', 'refreshing', 'stale', 'error']);
    if (!allowedStates.has(status.state)) {
      throw new RpcException('Unknown scanner status');
    }

    const engineVersion = this.scannerVersion(
      'Nuclei engine version',
      status.engineVersion,
    );
    const templateVersion = this.scannerVersion(
      'Nuclei template version',
      status.templateVersion,
    );
    if (status.templateSource !== 'projectdiscovery/nuclei-templates') {
      throw new RpcException('Invalid Nuclei template source');
    }
    if (status.lastError && status.lastError.length > 2048) {
      throw new RpcException('Nuclei scanner error exceeds 2048 characters');
    }

    const result = await this.repo.update(
      { id: workerId },
      {
        nucleiEngineVersion: engineVersion,
        nucleiTemplateVersion: templateVersion,
        nucleiTemplateSource: status.templateSource,
        nucleiTemplateStatus: status.state,
        nucleiTemplateLastAttemptAt: this.scannerTimestamp(
          status.lastUpdateAttemptAt,
        ),
        nucleiTemplateLastSuccessAt: this.scannerTimestamp(
          status.lastUpdateSuccessAt,
        ),
        nucleiTemplateValidatedAt: this.scannerTimestamp(
          status.lastValidatedAt,
        ),
        nucleiTemplateLastError: status.lastError || null,
        scannerStatusUpdatedAt: new Date(),
      },
    );
    if (!result.affected) {
      throw new RpcException('Worker not found');
    }
    return { message: 'Scanner status recorded' };
  }

  private scannerVersion(field: string, value: string): string | null {
    if (!value) {
      return null;
    }
    if (
      value.length > 64 ||
      !/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)
    ) {
      throw new RpcException(`Invalid ${field}`);
    }
    return value;
  }

  /** Returns distinct Nuclei template versions visible to a workspace. */
  public async getNucleiTemplateVersions(
    workspaceId: string,
  ): Promise<string[]> {
    const workers = await this.repo.find({
      select: { nucleiTemplateVersion: true },
      where: [
        {
          type: WorkerType.BUILT_IN,
          scope: WorkerScope.WORKSPACE,
          workspaceId,
        },
        { type: WorkerType.BUILT_IN, scope: WorkerScope.CLOUD },
      ],
    });

    return [
      ...new Set(
        workers
          .map((worker) => worker.nucleiTemplateVersion)
          .filter((version): version is string => Boolean(version)),
      ),
    ].sort();
  }

  /** Parses an optional worker timestamp and rejects malformed status data. */
  private scannerTimestamp(value?: string): Date | null {
    if (!value) {
      return null;
    }
    if (value.length > 64) {
      throw new RpcException('Invalid scanner status timestamp');
    }
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) {
      throw new RpcException('Invalid scanner status timestamp');
    }
    return timestamp;
  }

  /**
   * Automatically removes any workers that have been offline for at least 1 minute (60 seconds)
   * from the database. Uses hybrid approach: checks in-memory gRPC stream state first,
   * then falls back to DB lastSeenAt timestamp.
   *
   * - Worker has active gRPC stream → SKIP (connected)
   * - Worker has no stream BUT lastSeenAt not expired → SKIP (grace period)
   * - Worker has no stream AND lastSeenAt expired → DELETE
   */
  @Interval(WORKER_TIMEOUT)
  async autoCleanupWorkersAndJobs() {
    const staleWorkers = await this.repo.find({
      where: {
        lastSeenAt: LessThan(new Date(Date.now() - WORKER_TIMEOUT)),
      },
    });

    for (const worker of staleWorkers) {
      if (this.aliveStreamManager.isActive(worker.id)) {
        this.logger.debug(
          `[autoCleanup] Worker ${worker.id} has active stream, skipping deletion`,
        );
        continue;
      }

      this.logger.log(
        `[autoCleanup] Worker ${worker.id} has no active stream and lastSeenAt expired, removing`,
      );
      await this.workerLeave(worker.id);
    }

    // Update both in_progress jobs with missing workers and failed jobs
    await this.resetStuckAndFailedJobs();
  }

  /**
   * Removes a worker from the repository using its unique identifier.
   *
   * @param id - The unique identifier of the worker instance to be removed.
   * @returns A promise that resolves when the worker is successfully deleted.
   */

  private async workerLeave(id: string) {
    await this.releaseWorkerJobs(id);
    return this.repo.delete(id);
  }

  /**
   * Releases all IN_PROGRESS jobs held by a worker back to PENDING.
   * Does NOT delete the worker — used on stream disconnect so other
   * workers can pick up the freed jobs immediately.
   */
  public async releaseWorkerJobs(workerId: string) {
    await this.jobsRegistryService.repo
      .createQueryBuilder('jobs')
      .update()
      .set({ status: JobStatus.PENDING, workerId: () => 'NULL' })
      .where('jobs."workerId" = :id', { id: workerId })
      .andWhere('jobs.status = :status', { status: JobStatus.IN_PROGRESS })
      .execute();

    // Jobs paused mid-run stay paused (operator decision) but the dead
    // worker's claim is released so a later resume requeues them instead of
    // waiting for a worker that no longer exists.
    await this.jobsRegistryService.repo
      .createQueryBuilder('jobs')
      .update()
      .set({ workerId: () => 'NULL' })
      .where('jobs."workerId" = :id', { id: workerId })
      .andWhere('jobs.status = :status', { status: JobStatus.PAUSED })
      .execute();
  }

  /**
   * Updates runtime settings of a worker (desired concurrency, pause flag).
   * The worker itself applies the change on its next control poll; the DB
   * row is the durable source of truth so settings survive both core and
   * worker restarts.
   */
  public async updateWorkerSettings(
    id: string,
    dto: UpdateWorkerSettingsDto,
    workspaceId: string,
  ): Promise<WorkerInstance> {
    const worker = await this.repo.findOne({
      where: [
        { id, workspace: { id: workspaceId } },
        { id, scope: WorkerScope.CLOUD },
      ],
    });
    if (!worker) {
      throw new NotFoundException('Worker not found');
    }

    const update: Partial<WorkerInstance> = {};
    if (dto.maxConcurrency !== undefined) {
      update.maxConcurrency = dto.maxConcurrency;
    }
    if (dto.isPaused !== undefined) {
      update.isPaused = dto.isPaused;
    }

    if (Object.keys(update).length > 0) {
      await this.repo.update(id, update);
      // getNextJob caches the worker row for 30s; drop it so a pause takes
      // effect on the next dispatch attempt instead of after cache expiry.
      await this.repo.manager.connection.queryResultCache?.remove([
        `workers:${id}`,
      ]);
    }

    return this.repo.findOneOrFail({ where: { id } });
  }

  /**
   * Resolves the worker scope used for settings authorization without exposing
   * a workspace worker that belongs to a different workspace.
   */
  public async getWorkerManagementScope(
    id: string,
    workspaceId: string,
  ): Promise<WorkerScope> {
    const worker = await this.repo.findOne({
      where: { id },
      select: {
        id: true,
        scope: true,
        workspaceId: true,
      },
    });

    if (
      !worker ||
      (worker.scope === WorkerScope.WORKSPACE &&
        worker.workspaceId !== workspaceId)
    ) {
      throw new NotFoundException('Worker not found');
    }

    return worker.scope;
  }

  /**
   * Retrieves a paginated list of workers.
   *
   * @param query - The query parameters for filtering and pagination,
   *                including page, limit, sortOrder, and sortBy.
   * @returns A promise that resolves to a paginated list of workers
   *          along with total count and pagination information.
   */
  public async getWorkers(
    query: GetManyWorkersDto,
  ): Promise<GetManyBaseResponseDto<WorkerInstance>> {
    const { page, limit, sortOrder, workspaceId, enabledAgentMode, scope } =
      query;
    let { sortBy } = query;
    if (!sortBy) {
      sortBy = '"createdAt"';
    }

    const queryBuilder = this.repo
      .createQueryBuilder('w')
      .select('w')
      .addSelect(
        `(SELECT COUNT(j.id) FROM jobs j WHERE j."workerId"::uuid = w.id::uuid and j.status = '${JobStatus.IN_PROGRESS}')`,
        'currentJobsCount',
      )
      .leftJoinAndSelect('w.tool', 't')
      .where('1=1');

    // Add enabledAgentMode filter if provided
    if (enabledAgentMode !== undefined) {
      queryBuilder.andWhere('w."enabledAgentMode" = :enabledAgentMode', {
        enabledAgentMode,
      });
    }

    // Add explicit scope filter if provided
    if (scope) {
      queryBuilder.andWhere('w."scope" = :scopeFilter', {
        scopeFilter: scope,
      });

      // If filtering by workspace scope, also filter by workspaceId
      if (scope === 'workspace' && workspaceId) {
        queryBuilder.andWhere('w."workspaceId" = :workspaceId', {
          workspaceId,
        });

        // For PROVIDER type workers, ensure they have a corresponding workspace_tool record
        queryBuilder.andWhere(
          `(w.type != '${WorkerType.PROVIDER}' OR EXISTS (
            SELECT 1 FROM workspace_tools wt
            WHERE wt."workspaceId" = :workspaceId
            AND wt."toolId" = w."toolId"
            AND wt."isEnabled" = true
          ))`,
          { workspaceId },
        );
      }
    } else if (workspaceId) {
      // Legacy behavior: no explicit scope filter, but workspaceId provided
      queryBuilder.andWhere(
        '(w."workspaceId" = :workspaceId OR w."scope" = :cloudScope)',
        {
          workspaceId,
          cloudScope: WorkerScope.CLOUD,
        },
      );

      // For PROVIDER type workers, ensure they have a corresponding workspace_tool record
      queryBuilder.andWhere(
        `(w.type != '${WorkerType.PROVIDER}' OR EXISTS (
          SELECT 1 FROM workspace_tools wt
          WHERE wt."workspaceId" = :workspaceId
          AND wt."toolId" = w."toolId"
          AND wt."isEnabled" = true
        ))`,
        { workspaceId },
      );
    } else if (enabledAgentMode === undefined) {
      // If no workspaceId and no enabledAgentMode filter, include only cloud workers
      queryBuilder.andWhere('w."scope" = :cloudScope', {
        cloudScope: WorkerScope.CLOUD,
      });
    }

    const [workers, total] = await queryBuilder
      .orderBy(`w.${sortBy.replace(/[^a-zA-Z0-9_]/g, '')}`, sortOrder)
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    // Get current jobs count and active tools for each worker
    const workersWithJobCount = await Promise.all(
      workers.map(async (worker) => {
        const count = await this.jobsRegistryService['repo'].count({
          where: {
            workerId: worker.id,
            status: JobStatus.IN_PROGRESS,
          },
        });

        // Determine active tools based on worker type
        let tools: Tool[] = [];
        if (worker.type === WorkerType.BUILT_IN) {
          // For BUILT_IN workers, return all built-in tools
          const builtInTools = await this.toolsService.getBuiltInTools();
          tools = builtInTools.data;
        } else if (worker.tool) {
          // For PROVIDER workers, return the current tool as array
          tools = [worker.tool];
        }

        return {
          ...worker,
          currentJobsCount: count,
          tools,
          isOnline: this.aliveStreamManager.isActive(worker.id),
        };
      }),
    );

    return getManyResponse<WorkerInstance>({
      query,
      data: workersWithJobCount,
      total,
      ignoreFields: ['token', 'tool'],
    });
  }

  /**
   * Determines the worker type and scope based on the API key type.
   * @param apiKeyType - The type of the API key.
   * @returns An object containing the worker type and scope.
   */
  private determineWorkerTypeAndScope(apiKeyType: ApiKeyType): {
    type: WorkerType;
    scope: WorkerScope;
  } {
    if (apiKeyType === ApiKeyType.WORKSPACE) {
      return {
        type: WorkerType.BUILT_IN,
        scope: WorkerScope.WORKSPACE,
      };
    }

    return {
      type: WorkerType.PROVIDER,
      scope: WorkerScope.CLOUD,
    };
  }

  /**
   * Determines the worker association (workspace or tool) based on the API key type and reference.
   * @param apiKeyType - The type of the API key.
   * @param ref - The reference ID associated with the API key.
   * @returns An object containing either the workspace or tool association.
   */
  private determineWorkerAssociation(
    apiKeyType: ApiKeyType,
    ref: string,
  ): Partial<Pick<WorkerInstance, 'workspace' | 'tool'>> {
    if (apiKeyType === ApiKeyType.WORKSPACE) {
      return { workspace: { id: ref } as Workspace };
    }
    if (apiKeyType === ApiKeyType.TOOL) {
      return { tool: { id: ref } as Tool };
    }
    return {};
  }

  /**
   * Registers a worker in the database by creating a new worker instance.
   * Handles both cloud workers (using cloud API key) and regular workers (using API keys).
   *
   * @param dto - The data transfer object containing the API key.
   * @returns A promise that resolves to the created worker instance.
   */
  public async join(dto: WorkerJoinDto): Promise<WorkerInstance> {
    const { apiKey, token, metadata, ipAddress } = dto;

    if (token) {
      const existingWorker = await this.repo.findOne({
        where: { token },
      });
      if (!existingWorker) {
        throw new UnauthorizedException('Invalid worker identity token');
      }

      await this.fallbackWorkerRejoin(existingWorker.id);
      if (ipAddress) {
        await this.repo.update({ id: existingWorker.id }, { ipAddress });
      }
      return existingWorker;
    }

    if (apiKey.length < 32 || apiKey === 'change_me') {
      throw new UnauthorizedException(
        'Worker enrollment token must be at least 32 characters',
      );
    }

    const cloudApiKey = this.configService.get<string>('OASM_CLOUD_APIKEY');
    const isCloudWorker = this.secretsMatch(cloudApiKey, apiKey);

    if (!isCloudWorker) {
      const apiKeyRecord = await this.apiKeyService.apiKeysRepository.findOne({
        where: { key: apiKey },
      });
      if (!apiKeyRecord) {
        throw new RpcException('Worker enrollment token is invalid');
      }
    }

    if (isCloudWorker) {
      return this.createCloudWorker(metadata, ipAddress);
    }

    return this.createRegularWorker(apiKey, metadata, ipAddress);
  }

  private secretsMatch(expected: string | undefined, actual: string): boolean {
    if (!expected || expected.length < 32 || expected === 'change_me') {
      return false;
    }

    const expectedBytes = Buffer.from(expected);
    const actualBytes = Buffer.from(actual);
    return (
      expectedBytes.length === actualBytes.length &&
      timingSafeEqual(expectedBytes, actualBytes)
    );
  }

  /**
   * Creates a cloud worker instance.
   * @param metadata - The worker metadata.
   * @param ipAddress - The IP address of the worker.
   * @returns A promise that resolves to the created cloud worker.
   */
  private async createCloudWorker(
    metadata?: WorkerJoinDto['metadata'],
    ipAddress?: string,
  ): Promise<WorkerInstance> {
    const workerId = randomUUID();
    const TOKEN_LENGTH = 48;

    const data: Partial<WorkerInstance> = {
      id: workerId,
      token: generateToken(TOKEN_LENGTH),
      type: WorkerType.BUILT_IN,
      scope: WorkerScope.CLOUD,
      name: metadata?.name,
      os: metadata?.os,
      ipAddress,
    };

    await this.repo.save(data);

    const worker = await this.repo.findOne({
      where: { id: workerId },
    });

    if (!worker) {
      throw new Error('Failed to create cloud worker');
    }

    return worker;
  }

  /**
   * Creates a regular worker instance based on the provided API key.
   * @param apiKey - The API key to validate and use for worker creation.
   * @param metadata - The worker metadata.
   * @param ipAddress - The IP address of the worker.
   * @returns A promise that resolves to the created worker.
   */
  private async createRegularWorker(
    apiKey: string,
    metadata?: WorkerJoinDto['metadata'],
    ipAddress?: string,
  ): Promise<WorkerInstance> {
    const apiKeyRecord = await this.apiKeyService.apiKeysRepository.findOne({
      where: { key: apiKey },
    });

    if (!apiKeyRecord) {
      throw new RpcException('Worker enrollment token is invalid');
    }

    const workerId = randomUUID();
    const TOKEN_LENGTH = 48;

    const { type, scope } = this.determineWorkerTypeAndScope(apiKeyRecord.type);
    const association = this.determineWorkerAssociation(
      apiKeyRecord.type,
      apiKeyRecord.ref,
    );

    const data: Partial<WorkerInstance> = {
      id: workerId,
      token: generateToken(TOKEN_LENGTH),
      type,
      scope,
      ...association,
      name: metadata?.name,
      os: metadata?.os,
      ipAddress,
    };

    await this.repo.save(data);

    const worker = await this.repo.findOne({
      where: { id: workerId },
    });

    if (!worker) {
      throw new Error('Failed to create regular worker');
    }

    return worker;
  }

  /**
   * Validates a worker token by checking its existence in the database
   * @param token - The worker token to validate
   * @returns True if the token is valid, false otherwise
   */
  public async validateWorkerToken(
    token: string,
  ): Promise<WorkerInstance | null> {
    if (!token) {
      return null;
    }

    try {
      const worker = await this.repo.findOne({
        where: {
          token: token,
        },
      });

      return worker;
    } catch (error) {
      this.logger.error('Error validating worker token', error);
      return null;
    }
  }

  /**
   * Resets stuck in_progress jobs (missing workers) and failed jobs (retryable) back to pending.
   * This ensures jobs can be picked up by available workers.
   */
  private async resetStuckAndFailedJobs() {
    // Compare workerId as text against the worker ids to avoid a `::uuid` cast
    // that Postgres may evaluate on rows the WHERE clause would otherwise
    // exclude — an empty or malformed workerId would abort the whole cleanup.
    // The WHERE branches are parenthesised so `AND` does not silently bind
    // tighter than the intended `OR`.
    await this.repo.manager.query(`
      UPDATE jobs j
      SET status = CASE
          WHEN j.status = '${JobStatus.IN_PROGRESS}' THEN '${JobStatus.PENDING}'
          WHEN j.status = '${JobStatus.FAILED}' AND j."retryCount" < 4 THEN '${JobStatus.PENDING}'
          ELSE j.status
        END,
        "workerId" = NULL,
        "completedAt" = CASE
          WHEN j.status = '${JobStatus.IN_PROGRESS}' THEN NULL
          WHEN j.status = '${JobStatus.FAILED}' AND j."retryCount" < 4 THEN NULL
          ELSE j."completedAt"
        END
      WHERE (
          j.status = '${JobStatus.IN_PROGRESS}'
          AND (
            j."workerId" IS NULL
            OR j."workerId" NOT IN (SELECT id::text FROM workers)
          )
        )
        OR j.status = '${JobStatus.FAILED}'
    `);
  }

  /**
   * Resets all IN_PROGRESS jobs assigned to a specific worker back to PENDING.
   * Used when a worker rejoins after disconnection to reclaim pending work.
   * @param workerId - The ID of the worker whose jobs should be reset.
   */
  private async fallbackWorkerRejoin(workerId: string) {
    await this.jobsRegistryService.repo
      .createQueryBuilder()
      .update()
      .set({ status: JobStatus.PENDING })
      .where('workerId = :workerId', { workerId })
      .andWhere('status = :status', { status: JobStatus.IN_PROGRESS })
      .execute();
  }

  /**
   * Connects a worker to an internal network and inserts network interfaces.
   * Validates that the worker and network belong to the same workspace.
   * @param request - The request containing workerId, networkId, and network interfaces.
   * @returns A success message.
   */
  public async connectInternalNetwork(request: {
    workerId: string;
    networkId: string;
    networkInterfaces: Array<{
      interfaceName: string;
      ipAddress: string;
      cidr: string;
      gatewayIp: string;
      gatewayMac: string;
    }>;
  }): Promise<{ message: string }> {
    const { workerId, networkId, networkInterfaces } = request;

    // Find worker and get its workspace
    const worker = await this.repo.findOne({
      where: { id: workerId },
      relations: ['workspace'],
    });
    if (!worker) {
      throw new RpcException(`Worker not found: ${workerId}`);
    }
    const workerWorkspaceId = worker.workspace?.id ?? worker.workspaceId;
    if (!workerWorkspaceId) {
      throw new RpcException('Worker is not assigned to a workspace');
    }

    // Find network and check workspace
    const network = await this.internalNetworkRepo.findOne({
      where: { id: networkId },
    });
    if (!network) {
      throw new RpcException(`Internal network not found: ${networkId}`);
    }
    if (network.workspaceId !== workerWorkspaceId) {
      throw new RpcException(
        `Network and worker belong to different workspaces`,
      );
    }

    await this.repo.update(workerId, { internalNetwork: { id: networkId } });

    // Insert network interfaces, ignoring duplicates
    const interfacesToSave = networkInterfaces.map((ni) => ({
      workerId,
      internalNetworkId: networkId,
      interfaceName: ni.interfaceName,
      ipAddress: ni.ipAddress,
      cidr: ni.cidr,
      gatewayIp: ni.gatewayIp,
      gatewayMac: ni.gatewayMac,
    }));

    await this.networkInterfaceRepo
      .createQueryBuilder()
      .insert()
      .into(NetworkInterface)
      .values(interfacesToSave)
      .orIgnore()
      .execute();

    return { message: 'Connect success' };
  }

  public async enableAgentMode(workerId: string): Promise<void> {
    await this.repo.update(workerId, { enabledAgentMode: true });
  }
}
