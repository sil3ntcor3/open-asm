import type { HttpService } from '@nestjs/axios';
import { BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';
import type { Repository } from 'typeorm';
import type { WorkerInstance } from '../workers/entities/worker.entity';
import type { AliveStreamManager } from '../workers/alive-stream-manager.service';
import { WorkerType } from '@/common/enums/enum';
import type { Tool } from './entities/tools.entity';
import type { ToolUpdateState } from './entities/tool-update-state.entity';
import { ToolUpdateService } from './tool-update.service';

const toolId = '019ca5a9-2bc5-7fc0-bf20-1975d6ac7001';

function githubRelease(tagName = 'v1.10.0', prerelease = false) {
  return {
    tag_name: tagName,
    html_url: `https://github.com/projectdiscovery/httpx/releases/tag/${tagName}`,
    published_at: '2026-07-09T16:14:52Z',
    draft: false,
    prerelease,
    assets: [
      {
        name: `httpx_${tagName.slice(1)}_linux_amd64.zip`,
        browser_download_url: `https://github.com/projectdiscovery/httpx/releases/download/${tagName}/httpx_${tagName.slice(1)}_linux_amd64.zip`,
        digest: `sha256:${'a'.repeat(64)}`,
      },
    ],
  };
}

describe('ToolUpdateService', () => {
  let stateRepository: Partial<Repository<ToolUpdateState>>;
  let toolRepository: Partial<Repository<Tool>>;
  let workerRepository: Partial<Repository<WorkerInstance>>;
  let aliveStreamManager: Pick<AliveStreamManager, 'isActive'>;
  let httpService: Partial<HttpService>;
  let service: ToolUpdateService;

  beforeEach(() => {
    stateRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      upsert: jest.fn(),
    } as unknown as Partial<Repository<ToolUpdateState>>;
    toolRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
    };
    workerRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
    };
    aliveStreamManager = {
      isActive: jest.fn().mockReturnValue(true),
    };
    httpService = {
      get: jest.fn(),
    };
    service = new ToolUpdateService(
      stateRepository as Repository<ToolUpdateState>,
      toolRepository as Repository<Tool>,
      workerRepository as Repository<WorkerInstance>,
      httpService as HttpService,
      aliveStreamManager as AliveStreamManager,
    );
  });

  it('stores only stable release metadata with content digests', async () => {
    const state = {
      id: 'state-1',
      toolId,
      component: 'httpx',
      sourceRepository: 'projectdiscovery/httpx',
    } as ToolUpdateState;
    jest.mocked(stateRepository.findOne!).mockResolvedValue(state);
    jest
      .mocked(httpService.get!)
      .mockReturnValue(
        of({ data: githubRelease() }) as ReturnType<HttpService['get']>,
      );

    await service.checkComponent(toolId, 'httpx');

    expect(stateRepository.update).toHaveBeenCalledWith(
      { id: 'state-1' },
      expect.objectContaining({
        latestVersion: '1.10.0',
        releaseUrl:
          'https://github.com/projectdiscovery/httpx/releases/tag/v1.10.0',
        artifacts: [
          expect.objectContaining({
            name: 'httpx_1.10.0_linux_amd64.zip',
            sha256: 'a'.repeat(64),
          }),
        ],
        checkError: null,
      }),
    );
  });

  it('refuses prereleases even when GitHub marks one as latest', async () => {
    const state = {
      id: 'state-1',
      toolId,
      component: 'httpx',
      sourceRepository: 'projectdiscovery/httpx',
    } as ToolUpdateState;
    jest.mocked(stateRepository.findOne!).mockResolvedValue(state);
    jest
      .mocked(httpService.get!)
      .mockReturnValue(
        of({ data: githubRelease('v1.11.0-beta.1', true) }) as ReturnType<
          HttpService['get']
        >,
      );

    await expect(service.checkComponent(toolId, 'httpx')).rejects.toThrow(
      'stable release',
    );
    expect(stateRepository.update).toHaveBeenCalledWith(
      { id: 'state-1' },
      expect.objectContaining({
        latestVersion: null,
        checkError: expect.stringContaining('stable release'),
      }),
    );
  });

  it('creates a new deployment-wide request for one component', async () => {
    const state = {
      id: 'state-1',
      toolId,
      component: 'httpx',
      latestVersion: '1.10.0',
      sourceRepository: 'projectdiscovery/httpx',
      artifacts: [
        {
          name: 'httpx_1.10.0_linux_amd64.zip',
          url: 'https://github.com/projectdiscovery/httpx/releases/download/v1.10.0/httpx_1.10.0_linux_amd64.zip',
          sha256: 'a'.repeat(64),
        },
      ],
    } as unknown as ToolUpdateState;
    jest.mocked(stateRepository.findOne!).mockResolvedValue(state);
    jest.mocked(toolRepository.findOne!).mockResolvedValue({
      id: toolId,
      name: 'httpx',
    } as Tool);

    const result = await service.requestUpdate(toolId, 'httpx', 'admin-1');

    expect(result.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(stateRepository.update).toHaveBeenCalledWith(
      { id: 'state-1' },
      expect.objectContaining({
        requestedVersion: '1.10.0',
        requestedBy: 'admin-1',
      }),
    );
    expect(stateRepository.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ latestVersion: expect.anything() }),
    );
  });

  it('rejects an update when no verified release has been checked', async () => {
    jest.mocked(stateRepository.findOne!).mockResolvedValue({
      id: 'state-1',
      toolId,
      component: 'httpx',
    } as ToolUpdateState);
    jest.mocked(toolRepository.findOne!).mockResolvedValue({
      id: toolId,
      name: 'httpx',
    } as Tool);

    await expect(
      service.requestUpdate(toolId, 'httpx', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns one platform-specific directive until that worker reports the request terminal', async () => {
    const requestId = '019ca5a9-2bc5-7fc0-bf20-1975d6ac7002';
    jest.mocked(workerRepository.findOne!).mockResolvedValue({
      id: 'worker-1',
      type: WorkerType.BUILT_IN,
      toolStatuses: {
        httpx: { installedVersion: '1.9.0', state: 'ready' },
      },
    } as unknown as WorkerInstance);
    jest.mocked(stateRepository.find!).mockResolvedValue([
      {
        component: 'httpx',
        requestedVersion: '1.10.0',
        requestId,
        artifacts: [
          {
            name: 'httpx_1.10.0_linux_amd64.zip',
            url: 'https://github.com/projectdiscovery/httpx/releases/download/v1.10.0/httpx_1.10.0_linux_amd64.zip',
            sha256: 'a'.repeat(64),
          },
        ],
      } as ToolUpdateState,
    ]);

    await expect(
      service.getWorkerUpdatePlan('worker-1', 'linux', 'amd64'),
    ).resolves.toEqual([
      expect.objectContaining({
        requestId,
        component: 'httpx',
        targetVersion: '1.10.0',
        artifactName: 'httpx_1.10.0_linux_amd64.zip',
      }),
    ]);

    jest.mocked(workerRepository.findOne!).mockResolvedValue({
      id: 'worker-1',
      type: WorkerType.BUILT_IN,
      toolStatuses: {
        httpx: {
          installedVersion: '1.10.0',
          state: 'succeeded',
          requestId,
        },
      },
    } as unknown as WorkerInstance);

    await expect(
      service.getWorkerUpdatePlan('worker-1', 'linux', 'amd64'),
    ).resolves.toEqual([]);
  });

  it('does not issue built-in update plans to provider workers', async () => {
    jest.mocked(workerRepository.findOne!).mockResolvedValue({
      id: 'provider-worker',
      type: WorkerType.PROVIDER,
    } as WorkerInstance);

    await expect(
      service.getWorkerUpdatePlan('provider-worker', 'linux', 'amd64'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('synchronizes the independently managed component catalog without making worker-image tools updateable', async () => {
    jest.mocked(toolRepository.find!).mockResolvedValue([
      { id: 'tool-subfinder', name: 'subfinder' },
      { id: 'tool-httpx', name: 'httpx' },
      { id: 'tool-naabu', name: 'naabu' },
      { id: 'tool-nuclei', name: 'nuclei' },
      { id: 'tool-nmap', name: 'nmap' },
      { id: 'tool-screenshot', name: 'screenshot' },
    ] as Tool[]);

    await service.synchronizeCatalog();

    expect(stateRepository.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: 'tool-subfinder',
          component: 'subfinder',
          sourceRepository: 'projectdiscovery/subfinder',
        }),
        expect.objectContaining({
          toolId: 'tool-subfinder',
          component: 'dnsx',
          sourceRepository: 'projectdiscovery/dnsx',
        }),
        expect.objectContaining({
          toolId: 'tool-nuclei',
          component: 'nuclei-templates',
          sourceRepository: 'projectdiscovery/nuclei-templates',
        }),
      ]),
      ['toolId', 'component'],
    );
    expect(stateRepository.upsert).not.toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ component: 'nmap' }),
        expect.objectContaining({ component: 'screenshot' }),
      ]),
      expect.anything(),
    );
  });

  it('builds truthful managed, worker-image, and provider component views with per-worker rollout state', async () => {
    const requestId = '019ca5a9-2bc5-7fc0-bf20-1975d6ac7002';
    jest.mocked(stateRepository.find!).mockResolvedValue([
      {
        toolId: 'tool-httpx',
        component: 'httpx',
        displayName: 'httpx',
        sourceRepository: 'projectdiscovery/httpx',
        latestVersion: '1.10.0',
        requestId,
        requestedVersion: '1.10.0',
        requestedAt: new Date('2026-08-18T12:00:00Z'),
      } as ToolUpdateState,
      {
        toolId: 'tool-subfinder',
        component: 'dnsx',
        displayName: 'DNS resolver',
        sourceRepository: 'projectdiscovery/dnsx',
        latestVersion: '1.3.0',
      } as ToolUpdateState,
    ]);
    jest.mocked(workerRepository.find!).mockResolvedValue([
      {
        id: 'worker-1',
        name: 'Worker 1',
        toolStatuses: {
          httpx: {
            installedVersion: '1.10.0',
            state: 'succeeded',
            requestId,
          },
          nmap: { installedVersion: '7.93', state: 'ready' },
        },
      },
      {
        id: 'worker-2',
        name: 'Worker 2',
        toolStatuses: {
          httpx: { installedVersion: '1.9.0', state: 'ready' },
          nmap: { installedVersion: '7.93', state: 'ready' },
        },
      },
    ] as unknown as WorkerInstance[]);

    const components = await service.getToolComponents(
      [
        { id: 'tool-httpx', name: 'httpx', version: '1.7.1' },
        { id: 'tool-subfinder', name: 'subfinder', version: '2.14.0' },
        { id: 'tool-nmap', name: 'nmap', version: '7.99' },
        { id: 'tool-screenshot', name: 'screenshot', version: '1.0.0' },
        { id: 'tool-nessus', name: 'nessus', version: '' },
      ] as Tool[],
      'workspace-1',
    );

    expect(components.get('tool-httpx')).toEqual([
      expect.objectContaining({
        component: 'httpx',
        mode: 'managed',
        installedVersions: ['1.9.0', '1.10.0'],
        latestVersion: '1.10.0',
        updateAvailable: true,
        rollout: expect.objectContaining({
          requestId,
          totalWorkers: 2,
          succeeded: 1,
          pending: 1,
          failed: 0,
          workers: expect.arrayContaining([
            expect.objectContaining({
              workerId: 'worker-1',
              state: 'succeeded',
            }),
            expect.objectContaining({ workerId: 'worker-2', state: 'pending' }),
          ]),
        }),
      }),
    ]);
    expect(components.get('tool-subfinder')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: 'dnsx',
          installedVersions: [],
          updateAvailable: false,
        }),
      ]),
    );
    expect(components.get('tool-nmap')).toEqual([
      expect.objectContaining({
        component: 'nmap',
        mode: 'worker_image',
        installedVersions: ['7.93'],
      }),
    ]);
    expect(components.get('tool-screenshot')).toEqual([
      expect.objectContaining({ mode: 'worker_image' }),
    ]);
    expect(components.get('tool-nessus')).toEqual([
      expect.objectContaining({ mode: 'external' }),
    ]);
  });

  it('excludes disconnected worker records from installed versions and rollout progress', async () => {
    const requestId = '019ca5a9-2bc5-7fc0-bf20-1975d6ac7002';
    jest.mocked(stateRepository.find!).mockResolvedValue([
      {
        toolId: 'tool-httpx',
        component: 'httpx',
        displayName: 'httpx',
        sourceRepository: 'projectdiscovery/httpx',
        latestVersion: '1.10.0',
        requestId,
        requestedVersion: '1.10.0',
      } as ToolUpdateState,
    ]);
    jest.mocked(workerRepository.find!).mockResolvedValue([
      {
        id: 'active-worker',
        name: 'Active worker',
        toolStatuses: {
          httpx: { installedVersion: '1.9.0', state: 'ready' },
        },
      },
      {
        id: 'stale-worker',
        name: 'Stale worker',
        toolStatuses: {
          httpx: { installedVersion: '1.8.0', state: 'ready' },
        },
      },
    ] as unknown as WorkerInstance[]);
    jest
      .mocked(aliveStreamManager.isActive)
      .mockImplementation((workerId) => workerId === 'active-worker');

    const components = await service.getToolComponents(
      [{ id: 'tool-httpx', name: 'httpx', version: '1.7.1' }] as Tool[],
      'workspace-1',
    );

    expect(components.get('tool-httpx')).toEqual([
      expect.objectContaining({
        installedVersions: ['1.9.0'],
        rollout: expect.objectContaining({
          totalWorkers: 1,
          workers: [expect.objectContaining({ workerId: 'active-worker' })],
        }),
      }),
    ]);
  });
});
