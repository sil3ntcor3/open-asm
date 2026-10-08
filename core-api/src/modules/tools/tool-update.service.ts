import type { WorkerToolStatus } from '@/modules/workers/entities/worker.entity';
import { WorkerInstance } from '@/modules/workers/entities/worker.entity';
import { WorkerScope, WorkerType } from '@/common/enums/enum';
import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import { In, Repository } from 'typeorm';
import { AliveStreamManager } from '../workers/alive-stream-manager.service';
import {
  ToolReleaseArtifact,
  ToolUpdateState,
} from './entities/tool-update-state.entity';
import { Tool } from './entities/tools.entity';

const VERSION_PATTERN = /^v?\d+\.\d+\.\d+$/;
const DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/;
const PLATFORM_PATTERN = /^[a-z0-9_]+$/;

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
  digest?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
}

export interface ToolUpdateDirective {
  requestId: string;
  component: string;
  targetVersion: string;
  kind: 'artifact' | 'templates';
  artifactName?: string;
  artifactUrl?: string;
  sha256?: string;
}

type ToolUpdateMode = 'managed' | 'worker_image' | 'external';

interface ManagedToolComponentDefinition {
  toolName: string;
  component: string;
  displayName: string;
  sourceRepository: string;
}

const MANAGED_TOOL_COMPONENTS: readonly ManagedToolComponentDefinition[] = [
  {
    toolName: 'subfinder',
    component: 'subfinder',
    displayName: 'Subfinder engine',
    sourceRepository: 'projectdiscovery/subfinder',
  },
  {
    toolName: 'subfinder',
    component: 'dnsx',
    displayName: 'DNS resolver',
    sourceRepository: 'projectdiscovery/dnsx',
  },
  {
    toolName: 'httpx',
    component: 'httpx',
    displayName: 'httpx engine',
    sourceRepository: 'projectdiscovery/httpx',
  },
  {
    toolName: 'naabu',
    component: 'naabu',
    displayName: 'Naabu engine',
    sourceRepository: 'projectdiscovery/naabu',
  },
  {
    toolName: 'nuclei',
    component: 'nuclei',
    displayName: 'Nuclei engine',
    sourceRepository: 'projectdiscovery/nuclei',
  },
  {
    toolName: 'nuclei',
    component: 'nuclei-templates',
    displayName: 'Nuclei templates',
    sourceRepository: 'projectdiscovery/nuclei-templates',
  },
] as const;

const WORKER_IMAGE_COMPONENTS: Readonly<Record<string, string>> = {
  nmap: 'Nmap engine',
  screenshot: 'Screenshot engine (Chromium)',
};

export interface ToolUpdateWorkerView {
  workerId: string;
  workerName: string;
  state: WorkerToolStatus['state'];
  installedVersion?: string;
  targetVersion?: string;
  error?: string;
}

export interface ToolUpdateRolloutView {
  requestId: string;
  requestedVersion: string;
  requestedAt?: Date | null;
  totalWorkers: number;
  pending: number;
  updating: number;
  succeeded: number;
  failed: number;
  workers: ToolUpdateWorkerView[];
}

export interface ToolUpdateComponentView {
  component: string;
  displayName: string;
  mode: ToolUpdateMode;
  installedVersions: string[];
  latestVersion?: string | null;
  releaseUrl?: string | null;
  lastCheckedAt?: Date | null;
  checkError?: string | null;
  updateAvailable: boolean;
  rollout?: ToolUpdateRolloutView;
}

@Injectable()
export class ToolUpdateService {
  constructor(
    @InjectRepository(ToolUpdateState)
    private readonly stateRepository: Repository<ToolUpdateState>,
    @InjectRepository(Tool)
    private readonly toolRepository: Repository<Tool>,
    @InjectRepository(WorkerInstance)
    private readonly workerRepository: Repository<WorkerInstance>,
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => AliveStreamManager))
    private readonly aliveStreamManager: AliveStreamManager,
  ) {}

  /** Checks every managed component once per day without changing installed tools. */
  @Cron('17 4 * * *')
  public async checkAll(): Promise<{ checked: number; failed: number }> {
    const states = await this.stateRepository.find();
    const results = await Promise.allSettled(
      states.map((state) => this.checkComponent(state.toolId, state.component)),
    );
    return {
      checked: results.length,
      failed: results.filter((result) => result.status === 'rejected').length,
    };
  }

  /** Ensures every independently managed scanner component has durable release state. */
  public async synchronizeCatalog(): Promise<void> {
    const toolNames = [
      ...new Set(MANAGED_TOOL_COMPONENTS.map((entry) => entry.toolName)),
    ];
    const tools = await this.toolRepository.find({
      where: { name: In(toolNames) },
    });
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    const states = MANAGED_TOOL_COMPONENTS.flatMap((definition) => {
      const tool = toolsByName.get(definition.toolName);
      if (!tool?.id) return [];
      return [
        {
          toolId: tool.id,
          component: definition.component,
          displayName: definition.displayName,
          sourceRepository: definition.sourceRepository,
        },
      ];
    });
    if (states.length) {
      await this.stateRepository.upsert(states, ['toolId', 'component']);
    }
  }

  /** Builds component and per-worker rollout metadata for the Tools page. */
  public async getToolComponents(
    tools: Tool[],
    workspaceId: string,
  ): Promise<Map<string, ToolUpdateComponentView[]>> {
    const [states, workerRecords] = await Promise.all([
      this.stateRepository.find(),
      this.workerRepository.find({
        where: [
          {
            type: WorkerType.BUILT_IN,
            scope: WorkerScope.WORKSPACE,
            workspaceId,
          },
          { type: WorkerType.BUILT_IN, scope: WorkerScope.CLOUD },
        ],
      }),
    ]);
    const workers = workerRecords.filter((worker) =>
      this.aliveStreamManager.isActive(worker.id),
    );
    const stateByToolAndComponent = new Map(
      states.map((state) => [`${state.toolId}:${state.component}`, state]),
    );
    const result = new Map<string, ToolUpdateComponentView[]>();

    for (const tool of tools) {
      if (!tool.id) continue;
      const managedDefinitions = MANAGED_TOOL_COMPONENTS.filter(
        (definition) => definition.toolName === tool.name,
      );
      if (managedDefinitions.length) {
        result.set(
          tool.id,
          managedDefinitions.map((definition) => {
            const state = stateByToolAndComponent.get(
              `${tool.id}:${definition.component}`,
            );
            return this.componentView(
              definition.component,
              definition.displayName,
              'managed',
              tool,
              workers,
              state,
            );
          }),
        );
        continue;
      }

      const workerImageDisplayName = WORKER_IMAGE_COMPONENTS[tool.name];
      if (workerImageDisplayName) {
        result.set(tool.id, [
          this.componentView(
            tool.name,
            workerImageDisplayName,
            'worker_image',
            tool,
            workers,
          ),
        ]);
        continue;
      }

      result.set(tool.id, [
        {
          component: tool.name,
          displayName: `${tool.name} engine`,
          mode: 'external',
          installedVersions: tool.version ? [tool.version] : [],
          updateAvailable: false,
        },
      ]);
    }
    return result;
  }

  /** Refreshes one allowlisted component from its official stable GitHub release. */
  public async checkComponent(
    toolId: string,
    component: string,
  ): Promise<ToolUpdateState> {
    const state = await this.stateRepository.findOne({
      where: { toolId, component },
    });
    if (!state) {
      throw new NotFoundException('Tool update component not found');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<GitHubRelease>(
          `https://api.github.com/repos/${state.sourceRepository}/releases/latest`,
          {
            headers: {
              Accept: 'application/vnd.github+json',
              'User-Agent': 'open-asm-tool-update-checker',
              'X-GitHub-Api-Version': '2022-11-28',
            },
            timeout: 15_000,
          },
        ),
      );
      const release = this.validatedStableRelease(
        state.sourceRepository,
        response.data,
      );
      const releaseUpdate = {
        latestVersion: release.version,
        releaseUrl: release.releaseUrl,
        releasePublishedAt: release.publishedAt,
        lastCheckedAt: new Date(),
        checkError: null,
        artifacts: release.artifacts,
      };
      await this.stateRepository.update({ id: state.id }, releaseUpdate);
      return Object.assign(state, releaseUpdate);
    } catch (error) {
      const failedCheckUpdate = {
        latestVersion: null,
        releaseUrl: null,
        releasePublishedAt: null,
        artifacts: [],
        lastCheckedAt: new Date(),
        checkError: this.boundedError(error),
      };
      await this.stateRepository.update({ id: state.id }, failedCheckUpdate);
      Object.assign(state, failedCheckUpdate);
      throw error;
    }
  }

  /** Creates a fresh idempotency token for an administrator-approved rollout. */
  public async requestUpdate(
    toolId: string,
    component: string,
    requestedBy: string,
  ): Promise<ToolUpdateState> {
    const [tool, state] = await Promise.all([
      this.toolRepository.findOne({ where: { id: toolId } }),
      this.stateRepository.findOne({ where: { toolId, component } }),
    ]);
    if (!tool || !state) {
      throw new NotFoundException('Tool update component not found');
    }
    if (!state.latestVersion || !VERSION_PATTERN.test(state.latestVersion)) {
      throw new BadRequestException(
        'Check for a verified stable release before requesting an update',
      );
    }
    if (component !== 'nuclei-templates' && !state.artifacts?.length) {
      throw new BadRequestException(
        'The verified release has no supported artifacts',
      );
    }

    const rolloutUpdate = {
      requestId: randomUUID(),
      requestedVersion: state.latestVersion,
      requestedAt: new Date(),
      requestedBy,
    };
    await this.stateRepository.update({ id: state.id }, rolloutUpdate);
    return Object.assign(state, rolloutUpdate);
  }

  /** Returns pending update work for one authenticated worker and platform. */
  public async getWorkerUpdatePlan(
    workerId: string,
    os: string,
    arch: string,
  ): Promise<ToolUpdateDirective[]> {
    if (!PLATFORM_PATTERN.test(os) || !PLATFORM_PATTERN.test(arch)) {
      throw new BadRequestException('Invalid worker platform');
    }
    const worker = await this.workerRepository.findOne({
      where: { id: workerId },
    });
    if (!worker) {
      throw new NotFoundException('Worker not found');
    }
    if (worker.type !== WorkerType.BUILT_IN) {
      throw new BadRequestException(
        'Tool update plans are available only to built-in workers',
      );
    }
    const states = await this.stateRepository.find();
    const directives: ToolUpdateDirective[] = [];

    for (const state of states) {
      if (!state.requestId || !state.requestedVersion) continue;
      const workerStatus: WorkerToolStatus | undefined =
        worker.toolStatuses?.[state.component];
      if (
        workerStatus?.requestId === state.requestId &&
        ['succeeded', 'failed'].includes(workerStatus.state)
      ) {
        continue;
      }

      if (state.component === 'nuclei-templates') {
        directives.push({
          requestId: state.requestId,
          component: state.component,
          targetVersion: state.requestedVersion,
          kind: 'templates',
        });
        continue;
      }

      const artifact = this.platformArtifact(state.artifacts ?? [], os, arch);
      if (!artifact) continue;
      directives.push({
        requestId: state.requestId,
        component: state.component,
        targetVersion: state.requestedVersion,
        kind: 'artifact',
        artifactName: artifact.name,
        artifactUrl: artifact.url,
        sha256: artifact.sha256,
      });
    }
    return directives;
  }

  private validatedStableRelease(
    repository: string,
    release: GitHubRelease,
  ): {
    version: string;
    releaseUrl: string;
    publishedAt: Date;
    artifacts: ToolReleaseArtifact[];
  } {
    const tagName = release.tag_name;
    if (release.draft === true || release.prerelease === true) {
      throw new Error('GitHub latest release is not a stable release');
    }
    if (typeof tagName !== 'string' || !VERSION_PATTERN.test(tagName)) {
      throw new Error('GitHub stable release has an invalid version');
    }
    const version = tagName.replace(/^v/, '');
    const expectedReleaseUrl = `https://github.com/${repository}/releases/tag/${tagName}`;
    if (release.html_url !== expectedReleaseUrl) {
      throw new Error('GitHub stable release URL is not trusted');
    }
    const publishedAt = new Date(String(release.published_at));
    if (Number.isNaN(publishedAt.getTime())) {
      throw new Error('GitHub stable release date is invalid');
    }

    const assets = Array.isArray(release.assets) ? release.assets : [];
    const artifacts = assets.flatMap((assetValue) => {
      const asset = assetValue as GitHubReleaseAsset;
      if (
        typeof asset.name !== 'string' ||
        typeof asset.browser_download_url !== 'string' ||
        typeof asset.digest !== 'string'
      ) {
        return [];
      }
      const digest = DIGEST_PATTERN.exec(asset.digest);
      if (!digest || !asset.name.endsWith('.zip')) return [];
      const expectedPrefix = `https://github.com/${repository}/releases/download/${tagName}/`;
      if (
        !asset.browser_download_url.startsWith(expectedPrefix) ||
        asset.browser_download_url !== `${expectedPrefix}${asset.name}`
      ) {
        return [];
      }
      return [
        {
          name: asset.name,
          url: asset.browser_download_url,
          sha256: digest[1],
        },
      ];
    });

    return { version, releaseUrl: expectedReleaseUrl, publishedAt, artifacts };
  }

  private componentView(
    component: string,
    displayName: string,
    mode: ToolUpdateMode,
    tool: Tool,
    workers: WorkerInstance[],
    state?: ToolUpdateState,
  ): ToolUpdateComponentView {
    const reportedVersions = workers
      .map((worker) => worker.toolStatuses?.[component]?.installedVersion)
      .filter((version): version is string => Boolean(version));
    const installedVersions = [
      ...new Set(
        reportedVersions.length
          ? reportedVersions
          : component === tool.name && tool.version
            ? [tool.version]
            : [],
      ),
    ].sort((left, right) => this.compareVersions(left, right));
    const latestVersion = state?.latestVersion;
    const updateAvailable = Boolean(
      latestVersion &&
      installedVersions.some(
        (installed) => this.compareVersions(installed, latestVersion) < 0,
      ),
    );
    return {
      component,
      displayName,
      mode,
      installedVersions,
      latestVersion,
      releaseUrl: state?.releaseUrl,
      lastCheckedAt: state?.lastCheckedAt,
      checkError: state?.checkError,
      updateAvailable,
      rollout: state?.requestId
        ? this.rolloutView(state, component, workers)
        : undefined,
    };
  }

  private rolloutView(
    state: ToolUpdateState,
    component: string,
    workers: WorkerInstance[],
  ): ToolUpdateRolloutView {
    const workerViews = workers.map((worker): ToolUpdateWorkerView => {
      const reported = worker.toolStatuses?.[component];
      const belongsToRequest = reported?.requestId === state.requestId;
      return {
        workerId: worker.id,
        workerName: worker.name || worker.id,
        state: belongsToRequest ? reported.state : 'pending',
        installedVersion: reported?.installedVersion,
        targetVersion: state.requestedVersion ?? undefined,
        error: belongsToRequest ? reported.error : undefined,
      };
    });
    const count = (status: WorkerToolStatus['state']) =>
      workerViews.filter((worker) => worker.state === status).length;
    return {
      requestId: state.requestId!,
      requestedVersion: state.requestedVersion!,
      requestedAt: state.requestedAt,
      totalWorkers: workerViews.length,
      pending: count('pending'),
      updating: count('updating'),
      succeeded: count('succeeded'),
      failed: count('failed'),
      workers: workerViews,
    };
  }

  private compareVersions(left: string, right: string): number {
    const leftParts = left.replace(/^v/, '').split('.').map(Number);
    const rightParts = right.replace(/^v/, '').split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
      const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  }

  private platformArtifact(
    artifacts: ToolReleaseArtifact[],
    os: string,
    arch: string,
  ): ToolReleaseArtifact | undefined {
    const platformOs = os === 'darwin' ? 'macOS' : os;
    return artifacts.find((artifact) =>
      artifact.name.endsWith(`_${platformOs}_${arch}.zip`),
    );
  }

  private boundedError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return message.slice(0, 1024);
  }
}
