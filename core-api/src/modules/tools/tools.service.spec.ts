import { WorkerType } from '@/common/enums/enum';
import type { Repository } from 'typeorm';
import type { ApiKeysService } from '../apikeys/apikeys.service';
import type { Asset } from '../assets/entities/assets.entity';
import type { Vulnerability } from '../vulnerabilities/entities/vulnerability.entity';
import type { WorkersService } from '../workers/workers.service';
import type { ToolsQueryDto } from './dto/tools-query.dto';
import type { Tool } from './entities/tools.entity';
import type { WorkspaceTool } from './entities/workspace_tools.entity';
import type { ToolUpdateService } from './tool-update.service';
import { ToolsService } from './tools.service';

describe('ToolsService', () => {
  it('attaches update component metadata to every tool', async () => {
    const tools = [
      { id: 'tool-nuclei', name: 'nuclei', type: WorkerType.BUILT_IN },
      { id: 'tool-httpx', name: 'httpx', type: WorkerType.BUILT_IN },
    ] as Tool[];
    const toolsRepository = {
      findAndCount: jest.fn().mockResolvedValue([tools, tools.length]),
    } as unknown as Repository<Tool>;
    const workspaceToolRepository = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<WorkspaceTool>;
    const workerQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(3),
    };
    const workersService = {
      repo: {
        createQueryBuilder: jest.fn().mockReturnValue(workerQueryBuilder),
      },
    } as unknown as WorkersService;
    const getToolComponents = jest.fn().mockResolvedValue(
      new Map([
        [
          'tool-nuclei',
          [
            {
              component: 'nuclei-templates',
              displayName: 'Nuclei templates',
              mode: 'managed',
              installedVersions: ['10.4.6'],
              latestVersion: '10.4.7',
              updateAvailable: true,
            },
          ],
        ],
        [
          'tool-httpx',
          [
            {
              component: 'httpx',
              displayName: 'httpx engine',
              mode: 'managed',
              installedVersions: ['1.9.0'],
              latestVersion: '1.10.0',
              updateAvailable: true,
            },
          ],
        ],
      ]),
    );
    const toolUpdateService = {
      getToolComponents,
    } as unknown as ToolUpdateService;
    const service = new ToolsService(
      toolsRepository,
      workspaceToolRepository,
      {} as Repository<Asset>,
      {} as Repository<Vulnerability>,
      {} as ApiKeysService,
      workersService,
      toolUpdateService,
    );
    const query = {
      page: 1,
      limit: 10,
      workspaceId: 'workspace-1',
    } as ToolsQueryDto;

    const response = await service.getManyTools(query);

    expect(getToolComponents).toHaveBeenCalledWith(tools, 'workspace-1');
    expect(response.data.find((tool) => tool.name === 'nuclei')).toMatchObject({
      updateComponents: [
        expect.objectContaining({ component: 'nuclei-templates' }),
      ],
    });
    expect(response.data.find((tool) => tool.name === 'httpx')).toMatchObject({
      updateComponents: [expect.objectContaining({ component: 'httpx' })],
    });
  });
});

describe('ToolsService built-in tool synchronization', () => {
  it('refreshes stored commands when built-in definitions change', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const orUpdate = jest.fn().mockReturnThis();
    const queryBuilder = {
      insert: jest.fn().mockReturnThis(),
      orUpdate,
      values: jest.fn().mockReturnThis(),
      execute,
    };
    const toolsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const synchronizeCatalog = jest.fn().mockResolvedValue(undefined);
    const checkAll = jest.fn().mockResolvedValue({ checked: 6, failed: 0 });

    const service = new ToolsService(
      toolsRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { synchronizeCatalog, checkAll } as never,
    );

    await service.onModuleInit();

    expect(orUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        overwrite: expect.arrayContaining(['command']),
      }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(synchronizeCatalog).toHaveBeenCalledTimes(1);
    expect(checkAll).toHaveBeenCalledTimes(1);
  });
});
